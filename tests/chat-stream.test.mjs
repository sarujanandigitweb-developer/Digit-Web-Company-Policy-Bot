import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { readUIMessageStream } from "ai";

// The stream order is the regression: data parts written before the answer's `start`
// chunk create an empty assistant message (the stray "…" bubble). This test feeds the
// same chunk sequence the model produces through the real injector and through the
// SDK's own message reader, and counts the assistant messages it builds.
const source = readFileSync(new URL("../src/lib/chat-stream.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", js)(module, module.exports);
const { insertAfterStart } = module.exports;

const modelChunks = (messageId) => [
  { type: "start", messageId },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Employees accrue " },
  { type: "text-delta", id: "t1", delta: "2 leave days [1]." },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
  { type: "finish", finishReason: "stop" },
];
const dataChunks = [
  { type: "data-followups", data: { suggestions: ["Tell me more."] } },
  { type: "data-sources", data: [{ n: 1, chunkId: "c", documentId: "d", title: "Synthetic", excerpt: "E" }] },
];

async function replay(chunks) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const ids = new Set();
  let last = null;
  for await (const message of readUIMessageStream({ stream })) {
    // An id-less snapshot is the stray message the client would render as "…".
    ids.add(message.id ?? "<no-id>");
    last = message;
  }
  return { ids, last };
}

async function through(chunks, transform) {
  const out = [];
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const reader = source.pipeThrough(transform).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

test("data parts written before start create a second, empty assistant message", async () => {
  const before = [...dataChunks, ...modelChunks("answer-1")];
  const { ids } = await replay(before);
  assert.ok(ids.size > 1, "reproduces the stray empty message");
});

test("data parts inserted after start stay in the answer's single message", async () => {
  const shaped = await through(modelChunks("answer-1"), insertAfterStart(dataChunks));
  assert.deepEqual(shaped.slice(0, 2).map((c) => c.type), ["start", "data-followups"]);
  const { ids, last } = await replay(shaped);
  assert.deepEqual([...ids], ["answer-1"], "exactly one assistant message");
  const types = last.parts.map((p) => p.type);
  assert.ok(types.includes("data-followups") && types.includes("data-sources"));
  assert.equal(last.parts.filter((p) => p.type === "text").map((p) => p.text).join(""), "Employees accrue 2 leave days [1].");
});

test("with no model start (error first), no data is attached and no empty message appears", async () => {
  const errorFirst = [{ type: "error", errorText: "provider failed" }];
  const shaped = await through(errorFirst, insertAfterStart(dataChunks));
  assert.deepEqual(shaped.map((c) => c.type), ["error"]);
});
