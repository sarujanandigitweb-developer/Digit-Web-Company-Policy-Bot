/**
 * Citation markers for chat answers.
 *
 * The model cites excerpts as [1], [2]. Those numbers refer to the excerpts that
 * were put in the prompt for THAT answer. The server sends that exact list to the
 * browser as a `data-sources` part on the same message, so numbers resolve only
 * against their own answer. A number with no entry in that list stays plain text.
 *
 * Client-safe: no server imports.
 */

export interface CitationSource {
  /** The number the model wrote, 1-based. */
  n: number;
  chunkId: string;
  documentId: string;
  title: string;
  department: string;
  heading: string | null;
  pageNumber: number | null;
  /** The passage that was retrieved and shown to the model for this answer. */
  excerpt: string;
}

/** Reads the citation list from one message's parts. Returns [] when absent or malformed. */
export function citationSourcesFromParts(parts: ReadonlyArray<unknown>): CitationSource[] {
  for (const part of parts) {
    const typed = part as { type?: string; data?: unknown };
    if (typed.type !== "data-sources" || !Array.isArray(typed.data)) continue;
    const out: CitationSource[] = [];
    for (const raw of typed.data) {
      if (typeof raw !== "object" || raw === null) continue;
      const s = raw as Partial<CitationSource>;
      if (
        typeof s.n !== "number" ||
        !Number.isInteger(s.n) ||
        s.n < 1 ||
        typeof s.chunkId !== "string" ||
        typeof s.documentId !== "string" ||
        typeof s.title !== "string" ||
        typeof s.excerpt !== "string"
      ) {
        continue;
      }
      out.push({
        n: s.n,
        chunkId: s.chunkId,
        documentId: s.documentId,
        title: s.title,
        department: typeof s.department === "string" ? s.department : "",
        heading: typeof s.heading === "string" ? s.heading : null,
        pageNumber: typeof s.pageNumber === "number" ? s.pageNumber : null,
        excerpt: s.excerpt,
      });
    }
    return out;
  }
  return [];
}

const CITE_PREFIX = "#cite-";

/**
 * Rewrites `[n]` markers for numbers in `valid` into markdown links that the
 * renderer turns into citation buttons. Adjacent markers ([1][3]) are each handled.
 * Numbers not in `valid`, and anything already a link, are left untouched.
 */
export function linkCitations(markdown: string, valid: ReadonlySet<number>): string {
  return markdown.replace(/\[(\d{1,3})\](?!\()/g, (match, digits: string) => {
    const n = Number(digits);
    return valid.has(n) ? `[${n}](${CITE_PREFIX}${n})` : match;
  });
}

/** The citation number a rendered link points to, or null for any other link. */
export function citationNumberFromHref(href: string | undefined): number | null {
  if (!href || !href.startsWith(CITE_PREFIX)) return null;
  const n = Number(href.slice(CITE_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}
