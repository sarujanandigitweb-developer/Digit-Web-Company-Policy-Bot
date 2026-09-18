import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync("src/lib/services/google-drive.server.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const timestamp of ["2026-09-18 10:00:00+00", new Date("2026-09-18T10:00:00Z")]) {
  test(`same instant uses cache: ${typeof timestamp}`, async () => {
    let reads = 0;
    let fetches = 0;
    const exports = {};
    const mocks = {
      "@/lib/db/client.server": {
        sql: async () => {
          reads++;
          return [
            {
              modified_time: timestamp,
              mime_type: "text/plain",
              name: "Guide",
              extracted_text: "cached text",
              display_text: null,
              fetched_at: new Date().toISOString(),
            },
          ];
        },
      },
      "@/lib/knowledge/parse.server": {
        parse: () => {
          throw new Error("Cache hit must not parse");
        },
      },
      "./google-auth.server": { getDriveAccessToken: async () => "test-token" },
    };
    runInNewContext(code, {
      exports,
      require: (id) => {
        assert.ok(id in mocks);
        return mocks[id];
      },
      Date,
      Buffer,
      fetch: async (url) => {
        fetches++;
        assert.ok(url.endsWith("fields=modifiedTime"), "Cache hit must not download");
        return Response.json({ modifiedTime: "2026-09-18T10:00:00.000Z" });
      },
    });
    const link = { id: "test-file", kind: "file" };
    const results = await Promise.all([
      exports.getDriveDocument(link, "Guide"),
      exports.getDriveDocument(link, "Guide"),
    ]);
    assert.equal(results[0].text, "cached text");
    assert.equal(results[1].text, "cached text");
    assert.equal(reads, 1, "Concurrent requests share a cache read");
    assert.equal(fetches, 1, "Concurrent requests share Drive validation");
    await exports.getDriveDocument(link, "Guide");
    assert.equal(fetches, 2, "Later request still revalidates freshness");
  });
}
