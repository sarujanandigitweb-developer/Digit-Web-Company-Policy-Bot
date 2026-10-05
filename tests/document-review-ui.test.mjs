import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const module = { exports: {} };
const code = ts.transpileModule(
  readFileSync(new URL("../src/components/admin/document-review.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
const mocks = {
  "@/lib/api/client": {
    api: {
      get: async () => {
        throw new Error("SSR fixture must not fetch");
      },
    },
  },
  "@/components/ui/button": {
    Button: ({ children, variant, ...props }) => React.createElement("button", props, children),
  },
  "@/components/ui/textarea": { Textarea: (props) => React.createElement("textarea", props) },
  "./theme": { CARD: "card" },
  "./states": { ErrorState: () => React.createElement("p", null, "Error") },
};
runInNewContext(code, {
  module,
  exports: module.exports,
  require: (name) => mocks[name] ?? require(name),
});
const { DocumentReview } = module.exports;
function render(report) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["document-review", "fixture", 1], report);
  const html = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(DocumentReview, {
        document: { id: "fixture", status: "pending_review" },
      }),
    ),
  );
  client.clear();
  return html;
}
const base = {
  review_state: "ready",
  review_run: "run",
  review_origin: "upload",
  review_error: null,
  stale: false,
  total: 1,
  compared: 1,
  unresolved: 1,
  items: [
    {
      chunk_id: "chunk",
      chunk_index: 0,
      incoming_content: "Synthetic incoming: 15 days",
      heading: "Leave",
      page_number: 2,
      kind: "conflict",
      decision: null,
      note: null,
      approved_excerpt: null,
      matches: [
        {
          chunk_id: "old",
          document_title: "Synthetic existing handbook",
          heading: "Annual leave",
          page_number: 4,
          content: "Synthetic current: 10 days",
          relation: "conflict",
          explanation: "Different leave allowance",
        },
      ],
    },
  ],
};

test("review interface shows both source passages and blocks unresolved publication", () => {
  const html = render(base);
  assert.match(html, /Synthetic incoming: 15 days/);
  assert.match(html, /Synthetic current: 10 days/);
  assert.match(html, /Synthetic existing handbook/);
  assert.match(html, /page 4/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Publish reviewed content<\/button>/);
  assert.match(html, /Reason and policy owner&#x27;s confirmation/);
});
test("stale decisions cannot enable publication", () => {
  const html = render({ ...base, stale: true, unresolved: 0 });
  assert.match(html, /Approved knowledge changed during review/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Publish reviewed content<\/button>/);
});
test("fully compared new information enables explicit publication", () => {
  const html = render({
    ...base,
    unresolved: 0,
    items: [{ ...base.items[0], kind: "new", matches: [], decision: "include" }],
  });
  assert.match(html, /new information, included when published/);
  assert.match(html, /<button>Publish reviewed content<\/button>/);
});

test("a flagged passage offers leave-unresolved as an explicit decision", () => {
  const html = render(base);
  assert.match(html, /Leave unresolved: withhold this passage and keep the conflict open/);
  assert.match(html, /Keep existing guidance; exclude this entire passage/);
});
