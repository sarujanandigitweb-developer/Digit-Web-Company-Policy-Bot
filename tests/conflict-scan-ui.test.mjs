import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Server-rendered check of the scan results. The page is read-only by design, so
// the test also asserts that no decision controls are rendered for scan findings.
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const module = { exports: {} };
const code = ts.transpileModule(
  readFileSync(new URL("../src/components/admin/conflict-scan.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
const mocks = {
  "@tanstack/react-router": {
    Link: ({ children, to, params, ...props }) =>
      React.createElement(
        "a",
        { ...props, href: `${to}`.replace("$id", params?.id ?? "") },
        children,
      ),
  },
  "@/components/ui/button": {
    Button: ({ children, variant, size, ...props }) =>
      React.createElement("button", props, children),
  },
  "@/lib/api/client": {
    api: {
      get: async () => {
        throw new Error("SSR fixture must not fetch");
      },
      post: async () => {
        throw new Error("SSR fixture must not post");
      },
    },
    ApiError: class ApiError extends Error {},
  },
  "./theme": { CARD: "card" },
};
runInNewContext(code, {
  module,
  exports: module.exports,
  require: (name) => mocks[name] ?? require(name),
  console,
});
const { ConflictScanView } = module.exports;

const side = (title, id) => ({
  chunk_id: `${id}-chunk`,
  document_id: `${id}-doc`,
  title,
  department: "HR",
  heading: "Leave",
  page_number: 2,
  content: "Synthetic passage text for display",
});

const data = {
  scan: {
    id: "scan",
    status: "complete",
    cursor_chunk_id: "last",
    chunks_total: 4,
    chunks_done: 4,
    started_at: "2026-10-05T00:00:00Z",
    completed_at: "2026-10-05T00:05:00Z",
  },
  findings: [
    {
      relation: "conflict",
      explanation: "Synthetic: 14 days against 30 days",
      a: side("Synthetic A", "a"),
      b: side("Synthetic C", "c"),
    },
    {
      relation: "duplicate",
      explanation: "Synthetic: same rule",
      a: side("Synthetic A", "a"),
      b: side("Synthetic B", "b"),
    },
  ],
  counts: { conflict: 1, uncertain: 0, overlap: 0, duplicate: 1 },
};

function render(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(ConflictScanView, {
      data,
      running: false,
      progress: null,
      message: null,
      onStart: () => {},
      ...overrides,
    }),
  );
}

test("results show both sources for each finding, grouped by relation", () => {
  const html = render();
  assert.match(html, /Conflicts \(1\)/);
  assert.match(html, /Duplicates \(1\)/);
  assert.match(html, /Synthetic A/);
  assert.match(html, /Synthetic C/);
  assert.match(html, /Synthetic B/);
  assert.match(html, /Source A/);
  assert.match(html, /Source B/);
  assert.match(html, /Open document/);
});

test("progress reports checked passages and a determinate bar", () => {
  const html = render({ progress: { done: 2, total: 4 } });
  assert.match(html, /2 of 4 passages checked/);
  assert.match(html, /aria-valuenow="50"/);
});

test("the scan panel is read-only: it offers no decision or publish controls", () => {
  const html = render();
  assert.doesNotMatch(html, /Keep existing|Use incoming|Publish|Accept incoming|Keep both/);
  assert.match(html, /nothing is changed or withheld/i);
});

test("an empty completed scan says so instead of showing an empty list", () => {
  const html = render({
    data: { ...data, findings: [], counts: {} },
  });
  assert.match(html, /No conflicts, uncertain passages or duplicates were found/);
});
