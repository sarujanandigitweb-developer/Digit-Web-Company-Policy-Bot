import type { ParsedPage } from "./parse.server";

/**
 * Splits parsed pages into overlapping chunks that keep their heading and page.
 *
 * Heading tracking is the point: the existing chatbot recovers section titles by
 * regexing the model's prose, which silently yields nothing when the model
 * deviates. Carrying the heading on the chunk makes a citation a recorded fact.
 */

export interface ChunkOptions {
  /** Target chunk size in characters. */
  size: number;
  /** Characters repeated from the previous chunk, so a sentence spanning a
   *  boundary is still fully present in at least one chunk. */
  overlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  size: Number(process.env.KNOWLEDGE_CHUNK_SIZE ?? 1200),
  overlap: Number(process.env.KNOWLEDGE_CHUNK_OVERLAP ?? 200),
};

export interface Chunk {
  index: number;
  content: string;
  heading: string | null;
  pageNumber: number | null;
}

/** Markdown ATX headings, and the manual's own "6.1 General Leave Guidelines". */
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const NUMBERED_HEADING = /^\s*(\d{1,2}(?:\.\d{1,2})*)\s+([A-Z][^.\n]{2,80})\s*$/;

function headingOf(line: string): string | null {
  const markdown = MARKDOWN_HEADING.exec(line);
  if (markdown) return markdown[1].replace(/\*\*/g, "").trim();
  const numbered = NUMBERED_HEADING.exec(line);
  if (numbered) return `${numbered[1]} ${numbered[2].trim()}`;
  return null;
}

export function chunkPages(
  pages: ParsedPage[],
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  if (options.overlap >= options.size) {
    // Overlap >= size never advances the cursor: it would loop forever.
    throw new Error("Chunk overlap must be smaller than chunk size");
  }

  const chunks: Chunk[] = [];
  // Headings carry across page boundaries: a section usually outlives its page.
  let currentHeading: string | null = null;

  for (const page of pages) {
    for (const block of splitPage(page.text, options)) {
      const heading = firstHeadingIn(block) ?? currentHeading;
      currentHeading = lastHeadingIn(block) ?? currentHeading;
      const content = block.trim();
      if (!content) continue;
      chunks.push({
        index: chunks.length,
        content,
        heading,
        pageNumber: page.pageNumber,
      });
    }
  }
  return chunks;
}

/**
 * Slices one page into overlapping windows, preferring to break at a paragraph
 * or sentence boundary near the target size so chunks don't end mid-thought.
 */
function splitPage(text: string, options: ChunkOptions): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  if (normalized.trim().length === 0) return [];
  if (normalized.length <= options.size) return [normalized];

  const blocks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const hardEnd = Math.min(start + options.size, normalized.length);
    const end =
      hardEnd === normalized.length ? hardEnd : preferredBreak(normalized, start, hardEnd);
    blocks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    // Overlap is clamped to what was actually consumed, so a short final block
    // cannot push the cursor backwards.
    start = Math.max(end - options.overlap, start + 1);
  }
  return blocks;
}

/** Last paragraph/sentence break in the final third of the window, else hard cut. */
function preferredBreak(text: string, start: number, hardEnd: number): number {
  const searchFrom = start + Math.floor((hardEnd - start) * 0.6);
  const window = text.slice(searchFrom, hardEnd);

  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph > 0) return searchFrom + paragraph + 2;

  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf(".\n"));
  if (sentence > 0) return searchFrom + sentence + 2;

  const newline = window.lastIndexOf("\n");
  if (newline > 0) return searchFrom + newline + 1;

  return hardEnd;
}

function firstHeadingIn(block: string): string | null {
  for (const line of block.split("\n")) {
    const heading = headingOf(line);
    if (heading) return heading;
  }
  return null;
}

function lastHeadingIn(block: string): string | null {
  const lines = block.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const heading = headingOf(lines[i]);
    if (heading) return heading;
  }
  return null;
}
