import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Loads the TypeScript permission matrix without a build step. The file has no
// imports, so evaluating its transpiled output in an isolated context is enough.
function loadPermissions() {
  const source = readFileSync(
    new URL("../src/lib/auth/permissions.ts", import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(js, { module, exports: module.exports });
  return module.exports;
}

const { ADMIN_AREA_ROLES, hasAdminAreaAccess, ROLE_PERMISSIONS } = loadPermissions();

test("console roles are admitted to the admin area", () => {
  for (const role of ["team_leader", "admin", "super_admin"]) {
    assert.equal(hasAdminAreaAccess(role), true, role);
  }
});

test("missing or unknown roles are not admitted", () => {
  assert.equal(hasAdminAreaAccess(undefined), false);
  assert.equal(hasAdminAreaAccess(null), false);
  assert.equal(hasAdminAreaAccess(""), false);
  assert.equal(hasAdminAreaAccess("member"), false);
});

test("admin area roles match the roles that hold knowledge.manage", () => {
  // The admin area is the console. Every console role must be able to manage
  // knowledge, and no role outside the list may hold it.
  const holders = Object.keys(ROLE_PERMISSIONS).filter((r) =>
    ROLE_PERMISSIONS[r].includes("knowledge.manage"),
  );
  assert.deepEqual([...ADMIN_AREA_ROLES].sort(), holders.sort());
});
