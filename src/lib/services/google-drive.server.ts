import { sql } from "@/lib/db/client.server";
import { parse, type FileType } from "@/lib/knowledge/parse.server";
import { getDriveAccessToken } from "./google-auth.server";
import type { DriveLink } from "./google-sheet.server";

/**
 * Fetches and caches Google Drive document content for the user-facing
 * Document Library. Isolated from the Admin Knowledge system: this reads only
 * the pure `parse()` extractor it already had (mammoth/unpdf), and writes only
 * to drive_document_cache — never knowledge_documents or knowledge_chunks.
 *
 * TWO ACCESS PATHS, BY DESIGN
 *
 * A file that is "anyone with the link" shared (which is how every document
 * behind the sheet's links is shared today, verified live) can be downloaded
 * with a plain unauthenticated GET — exactly what a browser's "Download" does.
 * That path needs no credentials and works right now.
 *
 * A Drive FOLDER cannot be listed this way — verified live, 403 without a
 * token, and Drive's API refuses even an API key for files.list. Listing a
 * folder, reading a private file, and getting a file's modifiedTime all need
 * a service-account token. Where one is not configured, this module degrades
 * to "cannot expand this folder yet" rather than guessing or fabricating
 * contents — see listFolder below.
 */

export interface DriveDocument {
  name: string;
  mimeType: string;
  /**
   * The AI-safe copy: full document text, no chunking (see library-ai.server.ts
   * — the whole thing goes in the prompt), and no inline images. A base64
   * screenshot would burn most of the token budget for something the model
   * cannot see, so it never reaches the prompt.
   */
  text: string;
  /** The reading copy: same text WITH inline images, for the viewer. Equal to
   *  `text` when the document had none. */
  displayText: string;
  /** True once real content was found; false for an empty/unreadable file. */
  ready: boolean;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // used only when modifiedTime is unavailable

const MIME_TO_FILE_TYPE: Record<string, FileType> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
};

function fileTypeFromMime(mimeType: string, fallbackName: string): FileType | null {
  if (MIME_TO_FILE_TYPE[mimeType]) return MIME_TO_FILE_TYPE[mimeType];
  const ext = fallbackName.split(".").pop()?.toLowerCase();
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt") return "txt";
  return null;
}

/** Downloads raw bytes for a Drive file/document link. Public path first,
 *  service-account path only when the public one is refused. */
async function downloadBytes(link: DriveLink): Promise<{ buffer: Buffer; mimeType: string }> {
  const token = await getDriveAccessToken();

  if (link.kind === "document") {
    // A Google Doc — native or an uploaded .docx opened in Docs — exports as
    // a Word file, which the existing parser already handles.
    const url = `https://docs.google.com/document/d/${link.id}/export?format=docx`;
    const response = await fetch(url, { redirect: "follow" });
    if (response.ok) {
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }
    if (!token) {
      throw new Error(`Could not open this document (HTTP ${response.status})`);
    }
    // Fall through to the authenticated Drive API path below.
  }

  if (link.kind === "file" && !token) {
    const url = `https://drive.google.com/uc?export=download&id=${link.id}`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`Could not open this file (HTTP ${response.status})`);
    const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
    return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
  }

  if (!token) {
    throw new Error(
      "This item needs Google Drive access that has not been configured yet " +
        "(no service account key set).",
    );
  }

  // Authenticated Drive API path: works for a Google Doc (export) or any other
  // file (raw bytes), and for private files a public link could never reach.
  const meta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${link.id}?fields=name,mimeType`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!meta.ok) throw new Error(`Could not read this file's details (HTTP ${meta.status})`);
  const { mimeType } = (await meta.json()) as { name: string; mimeType: string };

  const isGoogleNative = mimeType.startsWith("application/vnd.google-apps");
  const url = isGoogleNative
    ? `https://www.googleapis.com/drive/v3/files/${link.id}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`
    : `https://www.googleapis.com/drive/v3/files/${link.id}?alt=media`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Could not download this file (HTTP ${response.status})`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: isGoogleNative
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : mimeType,
  };
}

/** Drive's own last-modified time for a file, or null without a service account. */
async function fetchModifiedTime(link: DriveLink): Promise<string | null> {
  const token = await getDriveAccessToken();
  if (!token) return null;
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${link.id}?fields=modifiedTime`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return null;
  return ((await response.json()) as { modifiedTime: string }).modifiedTime;
}

/**
 * The content behind one Drive link, from cache when possible.
 *
 * Cache key is drive_file_id; freshness is Drive's modifiedTime when a service
 * account can read it, or a 30-minute TTL when it cannot (see the migration's
 * comment — a deliberately weaker, temporary fallback, not a design choice).
 */
const documentRequests = new Map<string, Promise<DriveDocument>>();

export async function getDriveDocument(
  link: DriveLink,
  displayName: string,
): Promise<DriveDocument> {
  const key = JSON.stringify([link.id, displayName]);
  const existing = documentRequests.get(key);
  if (existing) return existing;
  const request = loadDriveDocument(link, displayName);
  documentRequests.set(key, request);
  try {
    return await request;
  } finally {
    documentRequests.delete(key);
  }
}

async function loadDriveDocument(link: DriveLink, displayName: string): Promise<DriveDocument> {
  const [cached, modifiedTime] = await Promise.all([
    sql`
    SELECT modified_time, mime_type, name, extracted_text, display_text, fetched_at
      FROM drive_document_cache WHERE drive_file_id = ${link.id}
  ` as unknown as Promise<
      Array<{
        modified_time: string | Date | null;
        mime_type: string;
        name: string;
        extracted_text: string;
        display_text: string | null;
        fetched_at: string;
      }>
    >,
    fetchModifiedTime(link),
  ]);

  if (cached[0]) {
    const row = cached[0];
    const stillFresh = modifiedTime
      ? row.modified_time !== null &&
        new Date(row.modified_time).getTime() === new Date(modifiedTime).getTime()
      : Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS;
    if (stillFresh) {
      return {
        name: row.name,
        mimeType: row.mime_type,
        text: row.extracted_text,
        displayText: row.display_text ?? row.extracted_text,
        ready: !!row.extracted_text.trim(),
      };
    }
  }

  const { buffer, mimeType } = await downloadBytes(link);
  const fileType = fileTypeFromMime(mimeType, displayName);
  if (!fileType) {
    throw new Error(`Unsupported file type for reading inside the dashboard: ${mimeType}`);
  }

  const parsed = await parse(buffer, fileType);
  // parse() already strips inline images from `pages` (see parse.server.ts) —
  // that copy is what the AI receives. displayPages, when present, is the
  // same content WITH images, for the viewer.
  const text = parsed.pages.map((p) => p.text).join("\n\n");
  const displayText = parsed.displayPages
    ? parsed.displayPages.map((p) => p.text).join("\n\n")
    : text;

  await sql`
    INSERT INTO drive_document_cache
      (drive_file_id, modified_time, mime_type, name, extracted_text, display_text)
    VALUES (${link.id}, ${modifiedTime}::timestamptz, ${mimeType}, ${displayName}, ${text},
            ${displayText === text ? null : displayText})
    ON CONFLICT (drive_file_id) DO UPDATE
      SET modified_time = EXCLUDED.modified_time,
          mime_type = EXCLUDED.mime_type,
          name = EXCLUDED.name,
          extracted_text = EXCLUDED.extracted_text,
          display_text = EXCLUDED.display_text,
          fetched_at = now()
  `;

  return { name: displayName, mimeType, text, displayText, ready: !!text.trim() };
}

/** Raw bytes for a PDF, streamed by our own route rather than redirecting the
 *  browser to Drive. Not cached in Postgres — large binary in a text column is
 *  the wrong tool; a request-scoped fetch is cheap enough for the sizes
 *  measured (tens to low hundreds of KB). */
export async function getDrivePdfBytes(fileId: string): Promise<Buffer> {
  const token = await getDriveAccessToken();
  const url = token
    ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    : `https://drive.google.com/uc?export=download&id=${fileId}`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Could not open this PDF (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export interface FolderChild {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
}

/**
 * Lists a Drive folder's direct children — the piece that needs a service
 * account and has no unauthenticated substitute (verified: 403 without a
 * token; Drive's API rejects an API key outright for this call). Returns null
 * rather than an empty array when no service account is configured, so the
 * caller can tell "empty folder" apart from "cannot check yet".
 */
export async function listFolder(folderId: string): Promise<FolderChild[] | null> {
  const token = await getDriveAccessToken();
  if (!token) return null;

  const children: FolderChild[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType)",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Could not list this folder (HTTP ${response.status})`);
    const body = (await response.json()) as {
      files: Array<{ id: string; name: string; mimeType: string }>;
      nextPageToken?: string;
    };
    for (const f of body.files) {
      children.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        isFolder: f.mimeType === "application/vnd.google-apps.folder",
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return children;
}
