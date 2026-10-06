import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Pure citation helpers, loaded from the TypeScript source without a build step.
const source = readFileSync(new URL("../src/lib/citations.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", js)(module, module.exports);
const { citationSourcesFromParts, linkCitations, citationNumberFromHref } = module.exports;

const sourcePart = (data) => ({ type: "data-sources", data });
const valid = {
  n: 1,
  chunkId: "c1",
  documentId: "d1",
  title: "Synthetic handbook",
  department: "HR",
  heading: "Leave",
  pageNumber: 2,
  excerpt: "Synthetic excerpt",
};

test("sources are read from the message's own data part only", () => {
  const other = { type: "data-followups", data: { documents: [] } };
  assert.deepEqual(citationSourcesFromParts([other]), []);
  const parsed = citationSourcesFromParts([{ type: "text", text: "hi" }, sourcePart([valid])]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "Synthetic handbook");
});

test("malformed source entries are dropped rather than guessed at", () => {
  const parsed = citationSourcesFromParts([
    sourcePart([
      valid,
      { n: 0, chunkId: "x", documentId: "y", title: "bad number", excerpt: "" },
      { n: 2, chunkId: "x", documentId: "y", excerpt: "no title" },
      null,
      "junk",
    ]),
  ]);
  assert.deepEqual(parsed.map((s) => s.n), [1]);
  assert.equal(citationSourcesFromParts([sourcePart("not an array")]).length, 0);
});

test("missing page and heading stay null: nothing is invented", () => {
  const [s] = citationSourcesFromParts([
    sourcePart([{ n: 1, chunkId: "c", documentId: "d", title: "T", excerpt: "E" }]),
  ]);
  assert.equal(s.heading, null);
  assert.equal(s.pageNumber, null);
  assert.equal(s.department, "");
});

test("adjacent markers each become a citation link", () => {
  const out = linkCitations("Rule applies [1][3].", new Set([1, 3]));
  assert.equal(out, "Rule applies [1](#cite-1)[3](#cite-3).");
});

test("repeated markers are each linked", () => {
  assert.equal(linkCitations("A [1]; B [1].", new Set([1])), "A [1](#cite-1); B [1](#cite-1).");
});

test("numbers with no source for this answer are left as plain text", () => {
  assert.equal(linkCitations("See [9] and [2].", new Set([2])), "See [9] and [2](#cite-2).");
  assert.equal(linkCitations("No sources at all [1].", new Set()), "No sources at all [1].");
});

test("existing markdown links are not rewritten", () => {
  const text = "[Read more](https://example.test/x) and [1].";
  assert.equal(linkCitations(text, new Set([1])), "[Read more](https://example.test/x) and [1](#cite-1).");
});

test("link hrefs map back to citation numbers only for our own prefix", () => {
  assert.equal(citationNumberFromHref("#cite-3"), 3);
  assert.equal(citationNumberFromHref("#cite-0"), null);
  assert.equal(citationNumberFromHref("#cite-x"), null);
  assert.equal(citationNumberFromHref("https://example.test"), null);
  assert.equal(citationNumberFromHref(undefined), null);
});
