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
  pages: ParsedPage[];
  pageCount: number | null;
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
    // chunker uses to attribute chunks to their section.
    const { value } = await mammoth.convertToMarkdown({ buffer });
    return { pages: [{ pageNumber: null, text: value }], pageCount: null };
  } catch (cause) {
    throw UnprocessableEntity("Could not read this DOCX file", { cause: String(cause) });
  }
}
