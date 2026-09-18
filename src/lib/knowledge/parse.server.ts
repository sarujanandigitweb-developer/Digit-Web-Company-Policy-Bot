import { BadRequest, UnprocessableEntity } from "@/lib/http/errors";

/**
 * Text extraction for the supported upload formats.
 *
 * Output is page-oriented because citations need to say where a claim came from.
 * PDFs have real pages; DOCX/TXT/MD do not, so they yield a single page and
 * chunks from them carry a null page number rather than a fabricated one.
 */

export type FileType = "pdf" | "docx" | "txt" | "md";

export interface ParsedPage {
  /** 1-based. Null for formats with no page concept. */
  pageNumber: number | null;
  text: string;
}

export interface ParsedDocument {
  /** Text only, no inline images. This is what gets chunked and embedded. */
  pages: ParsedPage[];
  pageCount: number | null;
  /**
   * The reading copy: the same content with inline images kept, for the
   * in-app document viewer. Undefined when it would be identical to `pages`.
   *
   * These are separate because they answer to different limits. A person
   * reading a screenshot-heavy method guide needs the screenshots; the
   * embedding API needs prose and chokes on base64. Storing one string for
   * both is what put three documents into status='failed' with 0 chunks.
   */
  displayPages?: ParsedPage[];
}

/**
 * Removes markdown images whose source is an inline data: URI.
 *
 * mammoth inlines every embedded image as base64. One LcMA method guide came to
 * 2.7MB of which 3.2KB was text — the rest was 36 screenshots. Chunking that
 * produces thousands of chunks of binary that no embedding model can use.
 *
 * The whole ![alt](data:…) construct goes, not just the URI, so the text is not
 * left peppered with empty "![]()". Images referenced by ordinary URLs are kept:
 * they cost a few characters, not megabytes.
 */
export function stripInlineImages(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "");
}

const EXTENSION_TO_TYPE: Record<string, FileType> = {
  pdf: "pdf",
  docx: "docx",
  txt: "txt",
  md: "md",
  markdown: "md",
};

/** Upload cap. Guards both memory in the function and embedding spend. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function fileTypeFromName(fileName: string): FileType {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const type = EXTENSION_TO_TYPE[extension];
  if (!type) {
    throw BadRequest(`Unsupported file type ".${extension}". Supported: PDF, DOCX, TXT, Markdown.`);
  }
  return type;
}

export async function parse(buffer: Buffer, fileType: FileType): Promise<ParsedDocument> {
  switch (fileType) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "txt":
    case "md":
      return { pages: [{ pageNumber: null, text: buffer.toString("utf8") }], pageCount: null };
  }
}

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // unpdf ships a serverless build of pdf.js — no filesystem or worker needed.
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    // mergePages:false keeps the per-page split that citations depend on.
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((pageText, i) => ({
      pageNumber: i + 1,
      text: pageText,
    }));
    return { pages, pageCount: totalPages };
  } catch (cause) {
    throw UnprocessableEntity("Could not read this PDF — it may be corrupt or password-protected", {
      cause: String(cause),
    });
  }
}

/** mammoth ships convertToMarkdown at runtime but omits it from its typings. */
type MammothMarkdown = {
  convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const mammoth = (await import("mammoth")) as unknown as MammothMarkdown;
  try {
    // Markdown rather than raw text: it keeps "# Heading" markers, which the
    // chunker uses to attribute chunks to their section, and gives the viewer
    // real headings, lists and tables to render instead of one block of text.
    const { value } = await mammoth.convertToMarkdown({ buffer });
    const searchable = stripInlineImages(value);
    return {
      pages: [{ pageNumber: null, text: searchable }],
      pageCount: null,
      // Only carried when images were actually removed, so a document without
      // them stores nothing extra.
      displayPages:
        searchable.length === value.length ? undefined : [{ pageNumber: null, text: value }],
    };
  } catch (cause) {
    throw UnprocessableEntity("Could not read this DOCX file", { cause: String(cause) });
  }
}
