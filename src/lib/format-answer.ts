/**
 * Makes a model's answer safe for this app's markdown renderer.
 *
 * WHY THIS EXISTS
 *
 * The chat renders answers with plain `react-markdown`: no table support (that
 * needs remark-gfm) and no raw HTML. The answering model is not fixed — the
 * gateway falls through five different providers, and each has its own habits.
 * Groq's gpt-oss-120b in particular writes:
 *
 *   - markdown tables, with `<br>` inside the cells to fake line breaks
 *   - citations as 【1】 or 【1†L1-L9】 instead of the [1] the prompt asks for
 *
 * With no table support the pipes and dashes are printed as text, the lines run
 * together into one paragraph, `<br>` shows literally, and the citations show in
 * a fallback font. The prompt asks for "short paragraphs or bullet lists" and
 * the models ignore it often enough that a prompt alone cannot be the fix.
 *
 * This runs on the text just before it is rendered, so it holds for whichever
 * provider answered. It changes how the answer is DISPLAYED only: the stored
 * answer and its recorded citations are untouched.
 *
 * It deliberately adds no dependency. A table is turned into a readable
 * bold-title-plus-bullets block instead — a table with "<br>" inside its cells
 * could not be rendered properly even with remark-gfm, because the line breaks
 * are raw HTML.
 */

const FENCE = /(```[\s\S]*?```)/g;

// `|---|:---:|` — a table's separator row. Needs at least one pipe so a plain
// horizontal rule (`---`) is never mistaken for one.
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

export function normalizeAnswer(text: string): string {
  if (!text) return text;
  // Fenced code is shown verbatim — a code sample may legitimately contain
  // pipes, <br> or 【】.
  return text
    .split(FENCE)
    .map((part, i) => (i % 2 === 1 ? part : normalizeProse(part)))
    .join("");
}

function normalizeProse(text: string): string {
  let out = flattenTables(text);
  // Anything still carrying <br> is outside a table: make it a real line break.
  out = out.replace(/<br\s*\/?>/gi, "\n");
  // 【1】, 【1†L1-L9】 -> [1]. A bracket with no leading number is a source
  // marker the reader cannot use, so it is dropped.
  out = out.replace(/【([^】]*)】/g, (_match, inner: string) => {
    const n = /^\s*(\d+)/.exec(inner);
    return n ? `[${n[1]}]` : "";
  });
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const plain = (s: string) => s.replace(/\*\*/g, "").trim();
const isRow = (line: string | undefined) => !!line && line.trim().startsWith("|");

/** A table is a `| header |` row, then a `|---|` row, then any number of `| row |`s. */
function flattenTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length;) {
    const next = lines[i + 1];
    if (isRow(lines[i]) && isRow(next) && next!.includes("|") && SEPARATOR.test(next!)) {
      const header = splitRow(lines[i]);
      const rows: string[][] = [];
      let j = i + 2;
      while (isRow(lines[j])) rows.push(splitRow(lines[j++]));
      out.push("", ...rows.map((row) => flattenRow(header, row)), "");
      i = j;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join("\n");
}

/**
 * One row -> a bold title (its first cell), then one bullet per remaining
 * column, labelled with that column's header. A cell holding several `<br>`
 * separated points becomes a nested list, which is what the model meant by them.
 */
function flattenRow(header: string[], cells: string[]): string {
  const [first, ...rest] = cells;
  const lines: string[] = [];
  if (plain(first ?? "")) lines.push(`**${plain(first)}**`);
  rest.forEach((cell, k) => {
    const label = plain(header[k + 1] ?? "");
    const parts = cell
      .split(/<br\s*\/?>/i)
      .map((p) => p.trim().replace(/^[•·▪●]\s*/, ""))
      .filter(Boolean);
    if (parts.length === 0) return;
    if (parts.length === 1) {
      lines.push(label ? `- **${label}:** ${parts[0]}` : `- ${parts[0]}`);
    } else {
      if (label) lines.push(`- **${label}:**`);
      for (const p of parts) lines.push(label ? `  - ${p}` : `- ${p}`);
    }
  });
  return lines.join("\n") + "\n";
}
