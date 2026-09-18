import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, mocks, env = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    exports,
    require: (id) => (id in mocks ? mocks[id] : require(id)),
    process: { env },
    Buffer,
    Date,
    Response,
  });
  return exports;
}

for (const [name, secret, token, allowed] of [
  ["missing configuration", undefined, "Bearer undefined", false],
  ["blank configuration", " ", "Bearer  ", false],
  ["missing token", "test-secret", null, false],
  ["incorrect token of equal length", "test-secret", "Bearer fake-secret", false],
  ["valid token", "test-secret", "Bearer test-secret", true],
]) {
  test(`cron authentication: ${name}`, async () => {
    let calls = 0;
    const { Route } = load(
      "../src/routes/api/cron.conversations.ts",
      {
        "@tanstack/react-router": { createFileRoute: () => (options) => options },
        "@/lib/http/handler": { api: (handler) => handler },
        "@/lib/http/errors": { ok: Response.json, Unauthorized: () => new Error("unauthorized") },
        "@/lib/services/conversations.service": {
          purgeOlderThan: async () => {
            calls++;
            return { deleted: 2 };
          },
        },
      },
      { CRON_SECRET: secret },
    );
    const request = new Request("http://localhost/api/cron/conversations", {
      headers: token ? { authorization: token } : {},
    });
    if (allowed) {
      const response = await Route.server.handlers.GET({ request });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { deleted: 2 });
    } else {
      await assert.rejects(Route.server.handlers.GET({ request }), /unauthorized/);
    }
    assert.equal(calls, allowed ? 1 : 0);
  });
}

for (const failAudit of [false, true]) {
  test(`retention ${failAudit ? "propagates audit failure to transaction rollback" : "uses database cutoff and records deleted IDs"}`, async () => {
    let committed = false;
    let audited = false;
    const tx = {
      query: async (query, values) => {
        if (query.startsWith("SELECT")) {
          assert.equal(values[0], 7);
          return { rows: [{ cutoff: "2026-09-11T00:00:00.000Z" }] };
        }
        assert.match(query, /WHERE started_at < \$1::timestamptz/);
        assert.equal(values[0], "2026-09-11T00:00:00.000Z");
        return { rows: [{ id: "old-session" }] };
      },
    };
    const { purgeOlderThan } = load("../src/lib/services/conversations.service.ts", {
      "@/lib/db/client.server": {
        withTransaction: async (fn) => {
          const result = await fn(tx);
          committed = true;
          return result;
        },
      },
      "@/lib/http/errors": { NotFound: () => new Error("not found") },
      "@/lib/audit/log.server": {
        write: async (client, entry) => {
          assert.equal(client, tx);
          assert.equal(entry.actor.userId, null);
          assert.equal(entry.oldValue.ids[0], "old-session");
          assert.equal(entry.newValue.retentionDays, 7);
          audited = true;
          if (failAudit) throw new Error("audit failed");
        },
      },
    });
    if (failAudit) await assert.rejects(purgeOlderThan(), /audit failed/);
    else assert.equal((await purgeOlderThan()).deleted, 1);
    assert.equal(audited, true);
    assert.equal(committed, !failAudit);
  });
}
