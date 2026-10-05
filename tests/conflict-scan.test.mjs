import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// Library conflict scan and chatbot disclosure, run against real PostgreSQL SQL
// (PGlite + pgvector + pg_trgm) with the actual migrations. Only the model and the
// embedding calls are replaced, by deterministic SYNTHETIC rules. These fixtures are
// not company policy, and they test SQL, scope and state handling, not model accuracy.
const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

function load(path, mocks = {}, cache = new Map()) {
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  cache.set(path, module.exports);
  const localRequire = (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`, mocks, cache);
    if (name.startsWith("."))
      return load(
        new URL(`${name}.ts`, new URL(path, root)).pathname.slice(root.pathname.length),
        mocks,
        cache,
      );
    return require(name);
  };
  const js = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, {
    module,
    exports: module.exports,
    require: localRequire,
    process,
    Buffer,
    console,
    AbortSignal,
    Date,
    Set,
    Map,
    URL,
  });
  cache.set(path, module.exports);
  return module.exports;
}

const vec = [1, ...Array(1535).fill(0)];
const literal = JSON.stringify(vec);

/**
 * SYNTHETIC classifier rule, used instead of the model. It is deliberately simple:
 * both passages state a 14-day notice rule  -> duplicate
 * one says 14 days and the other 30 days    -> conflict
 * anything else                             -> new
 */
function syntheticRelation(incoming, candidate) {
  const notice = /notice/i;
  if (!notice.test(incoming) || !notice.test(candidate)) return "new";
  const fourteen = /14|fourteen/i;
  const thirty = /30|thirty/i;
  if (fourteen.test(incoming) && fourteen.test(candidate)) return "duplicate";
  if (
    (fourteen.test(incoming) && thirty.test(candidate)) ||
    (thirty.test(incoming) && fourteen.test(candidate))
  ) {
    return "conflict";
  }
  return "new";
}

async function fixture(t) {
  const db = await PGlite.create({ extensions: { vector, pg_trgm } });
  t.after(() => db.close());
  await db.exec(
    'CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user"(id uuid PRIMARY KEY,email text);',
  );
  for (const file of [
    "0001_init.sql",
    "0003_knowledge_processing.sql",
    "0005_shared_departments.sql",
    "0006_rename_staff_to_team_leader.sql",
    "0008_knowledge_library.sql",
    "0010_document_display_text.sql",
  ]) {
    await db.exec(source(`migrations/${file}`));
  }
  const reviewMigration = source("migrations/0012_document_review.sql");
  await db.exec(reviewMigration.slice(0, reviewMigration.indexOf("BEGIN;")));
  await db.exec(reviewMigration.slice(reviewMigration.indexOf("BEGIN;")));
  await db.exec(source("migrations/0013_conflict_scan.sql"));

  const query = async (executor, text, params = []) => {
    if (text.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
    const result = await executor.query(text, params);
    return { ...result, rowCount: Math.max(result.affectedRows ?? 0, result.rows.length) };
  };
  const sql = async (strings, ...values) => {
    const params = [];
    let text = strings[0];
    values.forEach((v, i) => {
      if (v && typeof v === "object" && "unsafe" in v) text += v.unsafe;
      else {
        params.push(v);
        text += `$${params.length}`;
      }
      text += strings[i + 1];
    });
    return (await query(db, text, params)).rows;
  };
  const database = {
    sql,
    withTransaction: (fn) =>
      db.transaction((tx) => fn({ query: (text, params) => query(tx, text, params) })),
  };

  const adminId = randomUUID();
  const hr = randomUUID();
  const shared = randomUUID();
  const other = randomUUID();
  await db.query(
    `INSERT INTO departments(id,slug,name,is_shared) VALUES ($1,'hr','HR',false),($2,'test-shared','Shared',true),($3,'other','Other',false)`,
    [hr, shared, other],
  );
  await db.query(`INSERT INTO neon_auth."user"(id,email) VALUES ($1,'admin@example.test')`, [
    adminId,
  ]);
  await db.query(`INSERT INTO profiles(user_id,role,department_id) VALUES ($1,'admin',NULL)`, [
    adminId,
  ]);
  const admin = { userId: adminId, role: "admin", departmentId: null };

  let mode = "synthetic"; // or "uncertain" to simulate every provider failing
  let embedCalls = 0;
  const classifier = {
    classifyPassage: async (incomingText, candidates) =>
      candidates.map((c) => ({
        ...c,
        relation: mode === "uncertain" ? "uncertain" : syntheticRelation(incomingText, c.content),
        explanation: "Synthetic test comparison",
      })),
  };
  const mocks = {
    "@/lib/db/client.server": database,
    "./classify.server": classifier,
    "@/lib/knowledge/embed.server": {
      embedQuery: async () => {
        embedCalls++;
        return vec;
      },
      toVectorLiteral: JSON.stringify,
    },
    "./embed.server": {
      embedAll: async (texts) => ({
        vectors: texts.map(() => vec),
        stats: { embedded: texts.length, batches: 1, retries: 0 },
      }),
      toVectorLiteral: JSON.stringify,
    },
  };
  const review = load("src/lib/knowledge/review.server.ts", mocks);
  mocks["./review.server"] = review;
  const scan = load("src/lib/knowledge/conflict-scan.server.ts", mocks);
  const notice = load("src/lib/knowledge/conflict-notice.server.ts", mocks);
  mocks["@/lib/knowledge/conflict-notice.server"] = notice;

  async function document(title, content, departmentId) {
    const id = randomUUID();
    const chunkId = randomUUID();
    await db.query(
      `INSERT INTO knowledge_documents(id,department_id,title,file_name,file_type,file_size_bytes,checksum,
        status,chunk_count,extracted_text) VALUES ($1,$2,$3,'synthetic.txt','txt',1,$4,'active',1,$5)`,
      [id, departmentId, title, randomUUID(), content],
    );
    await db.query(
      `INSERT INTO knowledge_chunks(id,document_id,department_id,chunk_index,content,embedding,is_searchable)
       VALUES ($1,$2,$3,0,$4,$5::vector,true)`,
      [chunkId, id, departmentId, content, literal],
    );
    return { id, chunkId };
  }

  async function snapshot() {
    const docs = await db.query(
      `SELECT id,status,review_state,title,checksum FROM knowledge_documents ORDER BY id`,
    );
    const chunks = await db.query(
      `SELECT id,is_searchable,approved_content,content FROM knowledge_chunks ORDER BY id`,
    );
    const searchable = await db.query(`SELECT id FROM knowledge_search_chunks ORDER BY id`);
    return JSON.stringify({ docs: docs.rows, chunks: chunks.rows, searchable: searchable.rows });
  }

  return {
    db,
    admin,
    hr,
    shared,
    other,
    scan,
    notice,
    mocks,
    document,
    snapshot,
    setMode: (value) => {
      mode = value;
    },
    embedCount: () => embedCalls,
    request: new Request("http://localhost/conflict-scan", { method: "POST" }),
  };
}

/** Steps the scan to completion the way the browser does, one passage per call. */
async function runToCompletion(f, scanId) {
  let cursor = null;
  let steps = 0;
  for (;;) {
    const result = await f.scan.stepScan(scanId, cursor, f.admin, f.request);
    steps++;
    if (result.done) return steps;
    cursor = result.cursor;
    if (steps > 100) throw new Error("scan did not terminate");
  }
}

async function seedLibrary(f) {
  // SYNTHETIC fixtures. Department HR, shared, and an unrelated non-shared department.
  const a = await f.document(
    "Synthetic A",
    "Synthetic notice rule: staff give 14 days notice.",
    f.hr,
  );
  const b = await f.document(
    "Synthetic B",
    "Synthetic notice rule: fourteen days of notice are required.",
    f.hr,
  );
  const c = await f.document(
    "Synthetic C",
    "Synthetic notice rule: staff give 30 days notice.",
    f.hr,
  );
  const e = await f.document(
    "Synthetic E",
    "Synthetic holiday list, published each year.",
    f.shared,
  );
  const outside = await f.document(
    "Synthetic F",
    "Synthetic notice rule: 30 days notice here.",
    f.other,
  );
  return { a, b, c, e, outside };
}

test("library scan finds conflicts and duplicates once, from both sides, without changing knowledge", async (t) => {
  const f = await fixture(t);
  const docs = await seedLibrary(f);
  const before = await f.snapshot();

  const { id: scanId } = await f.scan.startScan(f.admin, f.request);
  await runToCompletion(f, scanId);

  const pairs = await f.db.query(
    `SELECT chunk_low, chunk_high, relation FROM knowledge_pair_comparisons ORDER BY relation`,
  );
  const keys = pairs.rows.map((r) => `${r.chunk_low}|${r.chunk_high}`);
  assert.equal(new Set(keys).size, keys.length, "each pair is stored exactly once");

  const outsideIds = [docs.outside.chunkId];
  const touchesOutside = pairs.rows.some(
    (r) => outsideIds.includes(r.chunk_low) || outsideIds.includes(r.chunk_high),
  );
  // F is in an unrelated, non-shared department: it may be compared only with the
  // shared department (E), never with HR, so it can never be reported as a conflict.
  const hrIds = [docs.a.chunkId, docs.b.chunkId, docs.c.chunkId];
  const outsideHrPairs = pairs.rows.filter(
    (r) =>
      (r.chunk_low === docs.outside.chunkId && hrIds.includes(r.chunk_high)) ||
      (r.chunk_high === docs.outside.chunkId && hrIds.includes(r.chunk_low)),
  );
  assert.equal(outsideHrPairs.length, 0, "unrelated departments are never compared");
  assert.ok(touchesOutside, "the shared department passage is still compared with the outside one");

  const status = await f.scan.getScan(scanId);
  assert.equal(status.scan.status, "complete");
  assert.equal(status.counts.conflict, 2, "A-C and B-C are conflicts");
  assert.equal(status.counts.duplicate, 1, "A-B is a duplicate");
  for (const finding of status.findings) {
    assert.ok(finding.a.title && finding.b.title, "both sides carry a source reference");
    assert.ok(finding.a.document_id && finding.b.document_id);
  }

  assert.equal(
    await f.snapshot(),
    before,
    "scanning changes no document, chunk or retrieval state",
  );
});

test("starting twice returns the running scan, and a repeated or stale step is refused", async (t) => {
  const f = await fixture(t);
  await seedLibrary(f);
  const first = await f.scan.startScan(f.admin, f.request);
  const second = await f.scan.startScan(f.admin, f.request);
  assert.equal(second.id, first.id, "a second start joins the running scan");

  const step = await f.scan.stepScan(first.id, null, f.admin, f.request);
  assert.equal(step.done, false);
  // Same stale cursor again: a double-click or a second admin. Refused, not applied twice.
  await assert.rejects(
    f.scan.stepScan(first.id, null, f.admin, f.request),
    (error) => error.status === 409,
  );
  const count = await f.db.query(`SELECT chunks_done FROM knowledge_conflict_scans WHERE id=$1`, [
    first.id,
  ]);
  assert.equal(count.rows[0].chunks_done, 1, "the refused step did not advance the scan");
});

test("a failed comparison is recorded as uncertain for review and publishes nothing", async (t) => {
  const f = await fixture(t);
  await seedLibrary(f);
  const before = await f.snapshot();
  f.setMode("uncertain");
  const { id } = await f.scan.startScan(f.admin, f.request);
  await runToCompletion(f, id);
  const status = await f.scan.getScan(id);
  assert.ok(status.counts.uncertain > 0, "unclassified pairs wait for human review");
  assert.equal(status.counts.conflict, 0);
  assert.equal(await f.snapshot(), before, "nothing becomes searchable or withheld");
});

test("chatbot discloses an in-scope conflict by title only, never by content", async (t) => {
  // Department HR may see the HR-only conflicts, but never passage text.
  const f = await fixture(t);
  await seedLibrary(f);
  const { id } = await f.scan.startScan(f.admin, f.request);
  await runToCompletion(f, id);

  const hrView = await f.notice.openConflicts({
    question: "How much notice is needed?",
    departmentId: f.hr,
    globalSearch: false,
    threshold: 0.5,
  });
  assert.ok(hrView.length >= 1, "a department user is told about a shared-scope conflict");
  const text = JSON.stringify(hrView);
  assert.ok(!/notice rule/i.test(text), "passage content never leaves the module");
  assert.ok(!/Synthetic F/.test(text), "outside documents are not named to HR");

  const shared = await f.notice.openConflicts({
    question: "notice",
    departmentId: null,
    globalSearch: false,
    sharedOnly: true,
    threshold: 0.5,
  });
  assert.equal(
    shared.length,
    0,
    "a shared-only question sees no conflict among non-shared documents",
  );
});

test("an outside department conflict is hidden from HR and visible to a global search", async (t) => {
  const f = await fixture(t);
  const docs = await seedLibrary(f);
  // Insert a conflict between an outside (non-shared) passage and a shared one. The
  // scan itself never compares these, so the row is added directly to test scoping.
  const shared = docs.e.chunkId;
  const outside = docs.outside.chunkId;
  const [low, high] = [outside, shared].sort();
  const { id: scanId } = await f.scan.startScan(f.admin, f.request);
  await f.db.query(
    `INSERT INTO knowledge_pair_comparisons(chunk_low,chunk_high,relation,explanation,scan_id) VALUES ($1,$2,'conflict','synthetic',$3)`,
    [low, high, scanId],
  );
  const hr = await f.notice.openConflicts({
    question: "notice",
    departmentId: f.hr,
    globalSearch: false,
    threshold: 0.5,
  });
  assert.ok(!hr.some((c) => c.titleA === "Synthetic F" || c.titleB === "Synthetic F"));
  const global = await f.notice.openConflicts({
    question: "notice",
    departmentId: null,
    globalSearch: true,
    threshold: 0.5,
  });
  assert.ok(global.some((c) => c.titleA === "Synthetic F" || c.titleB === "Synthetic F"));
});

test("a question with no open conflicts does not spend an embedding call", async (t) => {
  const f = await fixture(t);
  await seedLibrary(f);
  const result = await f.notice.openConflicts({
    question: "anything",
    departmentId: f.hr,
    globalSearch: false,
    threshold: 0.5,
  });
  // Length, not deepStrictEqual: arrays built inside the vm sandbox have a different prototype.
  assert.equal(result.length, 0);
  assert.equal(f.embedCount(), 0);
});

test("the answer prompt carries the disclosure and the failure fallback", async (t) => {
  const f = await fixture(t);
  await seedLibrary(f);
  const { id } = await f.scan.startScan(f.admin, f.request);
  await runToCompletion(f, id);

  const chat = load("src/lib/services/chat-knowledge.server.ts", {
    ...f.mocks,
    "./retrieval.service": {
      retrieveForUser: async () => ({ chunks: [], scope: "department" }),
    },
    "@/lib/knowledge/conflict-notice.server": f.notice,
  });
  const context = await chat.buildKnowledgeContext({
    question: "How much notice is needed?",
    departmentId: f.hr,
    globalSearch: false,
  });
  assert.match(context.system, /UNRESOLVED CONFLICT/);
  assert.match(context.system, /do not choose one source/);
  assert.match(context.system, /Synthetic A|Synthetic C|Synthetic B/);
  assert.ok(!/14 days notice/.test(context.system), "conflicting passage text is not quoted");

  // A failed conflict check must make the model cautious, not silent.
  const broken = load("src/lib/services/chat-knowledge.server.ts", {
    ...f.mocks,
    "./retrieval.service": { retrieveForUser: async () => ({ chunks: [], scope: "department" }) },
    "@/lib/knowledge/conflict-notice.server": {
      ...f.notice,
      openConflicts: async () => {
        throw new Error("simulated outage");
      },
    },
  });
  const fallback = await broken.buildKnowledgeContext({
    question: "notice",
    departmentId: f.hr,
    globalSearch: false,
  });
  assert.match(fallback.system, /conflict check could not run/);
});

test("with no open conflict the answer prompt is unchanged", async (t) => {
  const f = await fixture(t);
  const chat = load("src/lib/services/chat-knowledge.server.ts", {
    ...f.mocks,
    "./retrieval.service": { retrieveForUser: async () => ({ chunks: [], scope: "department" }) },
    "@/lib/knowledge/conflict-notice.server": f.notice,
  });
  const context = await chat.buildKnowledgeContext({
    question: "leave",
    departmentId: f.hr,
    globalSearch: false,
  });
  assert.match(context.system, /Sorry, I couldn't find information related to your question\./);
  assert.ok(!/UNRESOLVED CONFLICT/.test(context.system));
});
