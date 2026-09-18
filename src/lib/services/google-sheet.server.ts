import JSZip from "jszip";

/**
 * Reads the Document Library's source-of-truth hierarchy from a Google Sheet.
 *
 * Separate from everything the Admin Knowledge system uses. This module knows
 * nothing about knowledge_documents, knowledge_folders or knowledge_chunks —
 * it produces a plain tree from spreadsheet cells, nothing more.
 *
 * WHY xlsx AND NOT CSV
 *
 * Google's CSV and TSV exports carry only a cell's displayed text — hyperlinks
 * are dropped entirely. Verified against the real sheet: the CSV export has
 * zero URLs. The xlsx export is a zip of XML parts that keeps every cell's
 * hyperlink relationship intact — the same sheet's xlsx export carries all 107
 * Drive/Docs links. xlsx is therefore the only unauthenticated export that
 * actually contains what this feature needs.
 *
 * No Google credentials are required to read the Sheet itself: Sheets serves
 * its own export formats to anyone with the link, same as it serves the CSV
 * your browser downloads from File > Download. Credentials only become
 * necessary once a link points at a Drive FOLDER (see google-drive.server.ts).
 */

const SHEET_ID = process.env.LIBRARY_SHEET_ID || "1WAmQUBZTyyqPiHE11IMopYMav3Rab2koHKwninUJDzA";
const SHEET_GID = process.env.LIBRARY_SHEET_GID || "1900841522";

export type DriveLinkKind = "folder" | "document" | "file" | "spreadsheet" | "other";

export interface DriveLink {
  kind: DriveLinkKind;
  id: string;
  url: string;
}

export type NodeKind = "root" | "platform" | "model" | "section" | "method" | "document";

export interface LibraryNode {
  id: string;
  name: string;
  owner: string | null;
  kind: NodeKind;
  /**
   * A hierarchy cell (Platform/Model/Section/Method) can ITSELF be a Drive
   * folder link — e.g. "Method_01" names a folder whose contents are the real
   * documents. `link` here is that folder link, to expand later.
   * On kind:"document" it is the document/file link to fetch when opened.
   */
  link: DriveLink | null;
  /** True when `link` is a folder this deployment cannot list yet (no service
   *  account configured) — distinct from an empty folder. Set by the caller
   *  that expands folders (google-library.server.ts), not by this module. */
  pending?: boolean;
  children: LibraryNode[];
}

/** Classifies a Google URL by which Drive/Docs/Sheets object it points at. */
export function classifyDriveUrl(url: string): DriveLink | null {
  const folder = /\/drive\/folders\/([A-Za-z0-9_-]+)/.exec(url);
  if (folder) return { kind: "folder", id: folder[1], url };
  const doc = /\/document\/d\/([A-Za-z0-9_-]+)/.exec(url);
  if (doc) return { kind: "document", id: doc[1], url };
  const file = /\/file\/d\/([A-Za-z0-9_-]+)/.exec(url);
  if (file) return { kind: "file", id: file[1], url };
  const sheet = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url);
  if (sheet) return { kind: "spreadsheet", id: sheet[1], url };
  return null;
}

/** One parsed spreadsheet cell: its displayed text and, if any, its link. */
interface Cell {
  text: string;
  link: DriveLink | null;
}

/**
 * Downloads the sheet as xlsx and returns the target worksheet as a 2D array
 * of cells, each carrying its own text and (if the cell IS a hyperlink) the
 * Drive/Docs URL behind it.
 *
 * No caching here: this is one small HTTP fetch plus an in-memory zip read,
 * cheap enough to run per request. The expensive part — fetching and parsing
 * an actual DOCUMENT's content — is what gets cached, in google-drive.server.ts.
 */
async function readWorksheet(): Promise<Cell[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx&gid=${SHEET_GID}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Could not read the Knowledge Library sheet (HTTP ${response.status})`);
  }
  const zip = await JSZip.loadAsync(await response.arrayBuffer());

  // The workbook can hold several sheets; find the one matching our gid via
  // the workbook -> sheet -> rId chain, falling back to the first sheet if the
  // gid isn't found (a renamed/reordered tab should not break the import).
  const sheetPath = await resolveSheetPath(zip, SHEET_GID);
  const sheetXml = await zip.file(sheetPath)?.async("text");
  if (!sheetXml) throw new Error("Could not find the target worksheet inside the export");

  const sharedStrings = await readSharedStrings(zip);
  const hyperlinks = await readHyperlinks(zip, sheetPath);

  return parseSheetXml(sheetXml, sharedStrings, hyperlinks);
}

/** workbook.xml + workbook.xml.rels + sheetN.xml.rels chain → the right sheetN.xml path. */
async function resolveSheetPath(zip: JSZip, gid: string): Promise<string> {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
  if (workbookXml && relsXml) {
    const sheetMatch = new RegExp(`<sheet[^>]*sheetId="${gid}"[^>]*r:id="([^"]+)"`).exec(
      workbookXml,
    );
    // gid in the URL is not always the internal sheetId; try matching either
    // attribute order and fall back to matching by position if this fails.
    const rId =
      sheetMatch?.[1] ??
      new RegExp(`<sheet[^>]*r:id="([^"]+)"[^>]*sheetId="${gid}"`).exec(workbookXml)?.[1];
    if (rId) {
      const target = new RegExp(`<Relationship[^>]*Id="${rId}"[^>]*Target="([^"]+)"`).exec(
        relsXml,
      )?.[1];
      if (target) return `xl/${target.replace(/^\.?\/?/, "")}`;
    }
  }
  // Fall back to the first worksheet — better to read the wrong tab than to
  // fail outright, since a single-tab sheet is the common case.
  const first = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort()[0];
  if (!first) throw new Error("The export contains no worksheet");
  return first;
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("text");
  if (!xml) return [];
  // Each <si> may hold one <t> or several <r><t> runs; concatenate the runs so
  // rich (multi-styled) text still reads as one string.
  return [...xml.matchAll(/<si>(.*?)<\/si>/gs)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => decodeXmlEntities(t[1])).join(""),
  );
}

/** cell ref (e.g. "F7") -> the Drive/Docs link behind it, from sheetN.xml.rels. */
async function readHyperlinks(zip: JSZip, sheetPath: string): Promise<Map<string, string>> {
  const dir = sheetPath.replace(/\/[^/]+$/, "");
  const file = sheetPath.replace(/^.*\//, "");
  const relsXml = await zip.file(`${dir}/_rels/${file}.rels`)?.async("text");
  const sheetXml = await zip.file(sheetPath)?.async("text");
  const map = new Map<string, string>();
  if (!relsXml || !sheetXml) return map;

  const targetById = new Map(
    [...relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)]
      .map((m) => [attr(m[1], "Id"), attr(m[1], "Target")] as const)
      .filter((pair): pair is [string, string] => !!pair[0] && !!pair[1]),
  );
  // Attribute order in the real export is r:id BEFORE ref
  // (`<hyperlink r:id="rId1" ref="F1"/>`) — the opposite of the order a
  // hand-written OOXML example usually shows, and the reason a
  // position-dependent regex silently matched zero hyperlinks. Matching each
  // attribute independently, rather than assuming an order, survives either
  // arrangement.
  for (const m of sheetXml.matchAll(/<hyperlink\b([^>]*)\/?>/g)) {
    const ref = attr(m[1], "ref");
    const rId = attr(m[1], "r:id");
    if (!ref || !rId) continue;
    const target = targetById.get(rId);
    if (target) map.set(ref, decodeXmlEntities(target));
  }
  return map;
}

/** One named attribute out of a raw XML tag's attribute string, order-independent. */
function attr(attrs: string, name: string): string | null {
  const escaped = name.replace(/:/g, "\\:");
  const m = new RegExp(`${escaped}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheetXml(
  xml: string,
  sharedStrings: string[],
  hyperlinks: Map<string, string>,
): Cell[][] {
  const rows: Cell[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>(.*?)<\/row>/gs)) {
    const rowIndex = Number(rowMatch[1]) - 1;
    const cells: Cell[] = [];
    for (const cellMatch of rowMatch[2].matchAll(
      /<c r="([A-Z]+)\d+"([^>]*)>(?:<v>(.*?)<\/v>|<is><t[^>]*>(.*?)<\/t><\/is>)?<\/c>/gs,
    )) {
      const [, col, attrs, rawValue, inlineText] = cellMatch;
      const isSharedString = /t="s"/.test(attrs);
      const text = inlineText
        ? decodeXmlEntities(inlineText)
        : isSharedString && rawValue !== undefined
          ? (sharedStrings[Number(rawValue)] ?? "")
          : (rawValue ?? "");
      const ref = `${col}${rowMatch[1]}`;
      const link = hyperlinks.has(ref) ? classifyDriveUrl(hyperlinks.get(ref)!) : null;
      cells[colToIndex(col)] = { text: text.trim(), link };
    }
    rows[rowIndex] = cells;
  }
  // Fill sparse rows/columns so index access below never throws.
  const width = Math.max(0, ...rows.map((r) => (r ? r.length : 0)));
  return rows.map((r) => {
    const row = r ?? [];
    return Array.from({ length: width }, (_, i) => row[i] ?? { text: "", link: null });
  });
}

/**
 * Column layout of the "Stage 2. Creation of new listing" block, by header
 * text rather than a hardcoded index — a column reordering shifts the numbers
 * but not the header labels, so this is the more durable of the two options.
 * Falls back to the known positions (F,G,H,I,J = 5,6,7,8,9) if headers can't
 * be located, since that is the sheet's layout at the time this was written.
 */
interface HierarchyColumns {
  cols: number[];
  /** The row the header itself was found on — the tree builder must start
   *  reading data on the row AFTER this one, or the literal header text
   *  ("Sub folder") gets read as if it were a real folder name. */
  headerRowIndex: number;
}

function findHierarchyColumns(rows: Cell[][]): HierarchyColumns {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const mainFolder = row.findIndex((c) => /^main folder$/i.test(c.text));
    if (mainFolder === -1) continue;
    const cols = [mainFolder];
    for (let i = mainFolder + 1; i < row.length && cols.length < 5; i++) {
      if (/^sub folder$/i.test(row[i].text)) cols.push(i);
    }
    if (cols.length >= 2) return { cols, headerRowIndex: r };
  }
  return { cols: [5, 6, 7, 8, 9], headerRowIndex: -1 };
}

/** "Model_03\nFarshad's" -> { name: "Model_03", owner: "Farshad's" }. */
function splitNameOwner(text: string): { name: string; owner: string | null } {
  const [name, owner] = text.split(/\r?\n/, 2).map((s) => s.trim());
  return { name, owner: owner || null };
}

/**
 * A node's id is derived, never counted. A Drive-linked node (document, file,
 * or a folder-linked hierarchy level) uses that Drive id directly — Drive ids
 * are already globally stable. A plain named folder with no link of its own
 * (e.g. "Amazon") uses its ancestor path instead. Either way, the SAME node
 * gets the SAME id on every rebuild, in every instance — required because a
 * browser tab holds onto a node id across the tree cache's TTL and across
 * cold starts; a counter would silently invalidate it on the next rebuild.
 */
function nodeId(link: DriveLink | null, path: string[]): string {
  return link ? `d:${link.id}` : `p:${path.join("/")}`;
}

/**
 * Builds the tree from the hierarchy columns, using "fill down": a Google
 * Sheet's merged/visually-grouped cells export as blank cells on every row but
 * the first, so a blank cell inherits the last non-blank value seen in that
 * column above it — exactly how a person reads the sheet visually.
 */
export async function fetchLibraryTree(): Promise<LibraryNode> {
  const allRows = await readWorksheet();
  const { cols, headerRowIndex } = findHierarchyColumns(allRows);
  // Data starts the row AFTER the header. Without this, the header's own
  // literal cell text ("Sub folder", repeated across four columns) is read as
  // if it were a real folder name, producing a bogus platform on every run.
  const rows = allRows.slice(headerRowIndex + 1);

  const root: LibraryNode = {
    id: nodeId(null, ["root"]),
    name: "Knowledge Library",
    owner: null,
    kind: "root",
    link: null,
    children: [],
  };

  // One "current node" per level, carried down through blank (merged) cells,
  // alongside the ancestor NAME path used to derive a stable id for a plain
  // (link-less) folder.
  const current: (LibraryNode | null)[] = [root, null, null, null, null];
  const namePath: string[][] = [[], [], [], [], []];
  const kinds: NodeKind[] = ["platform", "model", "section", "method"];

  for (const row of rows) {
    for (let level = 0; level < cols.length - 1; level++) {
      const cell = row[cols[level + 1]];
      if (!cell || !cell.text) continue; // blank -> inherit, nothing to add

      const parent = current[level];
      const path = namePath[level];
      if (!parent) continue; // no ancestor yet -> malformed row, skip safely

      const { name, owner } = splitNameOwner(cell.text);

      if (cell.link && cell.link.kind !== "folder") {
        // A hierarchy cell linking straight to a document/file is a document
        // sitting directly on this level (the "ragged depth" case —
        // Model_02/Bietrick's holds documents straight off the model, with no
        // Section/Method beneath). It is a leaf: nothing nests under it.
        parent.children.push({
          id: nodeId(cell.link, []),
          name,
          owner: null,
          kind: "document",
          link: cell.link,
          children: [],
        });
        continue;
      }

      // A plain folder name, OR a hierarchy cell linking to a Drive FOLDER
      // (e.g. "Method_01" names a folder whose real documents live inside it —
      // that folder is expanded separately, in google-library.server.ts,
      // because it needs a Drive API call this module intentionally never
      // makes). Reuse an existing sibling with the same name rather than
      // duplicating it, so re-reading the sheet is stable.
      let node = parent.children.find((c) => c.kind === kinds[level] && c.name === name);
      if (!node) {
        node = {
          id: nodeId(cell.link, [...path, name]),
          name,
          owner,
          kind: kinds[level],
          link: cell.link,
          children: [],
        };
        parent.children.push(node);
      } else if (!node.link && cell.link) {
        node.link = cell.link;
      }
      current[level + 1] = node;
      namePath[level + 1] = [...path, name];
    }
  }

  return root;
}
