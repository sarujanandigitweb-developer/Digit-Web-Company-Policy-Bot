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

// Real PostgreSQL/pgvector SQL, with deterministic model and embedding fixtures.
// No live credentials, policy documents, or external provider calls are used.
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
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
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
  });
  cache.set(path, module.exports);
  return module.exports;
}
const policy = load("src/lib/knowledge/review-policy.ts");
const vec = [1, ...Array(1535).fill(0)];
const literal = JSON.stringify(vec);
const request = new Request("http://localhost/review", { method: "PATCH" });

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
  const migration = source("migrations/0012_document_review.sql");
  // psql autocommit semantics: commit ALTER TYPE before using its new value.
  await db.exec(migration.slice(0, migration.indexOf("BEGIN;")));
  await db.exec(migration.slice(migration.indexOf("BEGIN;")));
  const query = async (executor, text, params = []) => {
    // PGlite is single-connection; native multi-connection lock contention is
    // outside this harness. All other SQL executes unchanged.
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
  sql.unsafe = (unsafe) => ({ unsafe });
  const database = {
    sql,
    withTransaction: (fn) =>
      db.transaction((tx) => fn({ query: (text, params) => query(tx, text, params) })),
  };
  const adminId = randomUUID(),
    leaderId = randomUUID(),
    dept = randomUUID(),
    shared = randomUUID(),
    other = randomUUID();
  await db.query(
    `INSERT INTO departments(id,slug,name,is_shared) VALUES ($1,'hr','HR',false),($2,'test-shared','Shared',true),($3,'other','Other',false)`,
    [dept, shared, other],
  );
  await db.query(
    `INSERT INTO neon_auth."user"(id,email) VALUES ($1,'admin@example.test'),($2,'leader@example.test')`,
    [adminId, leaderId],
  );
  await db.query(
    `INSERT INTO profiles(user_id,role,department_id) VALUES ($1,'admin',NULL),($2,'team_leader',$3)`,
    [adminId, leaderId, dept],
  );
  const admin = { userId: adminId, role: "admin", departmentId: null },
    leader = { userId: leaderId, role: "team_leader", departmentId: dept };
  let relation = "conflict";
  let beforeEmbedding = null;
  const mocks = {
    "@/lib/db/client.server": database,
    "./classify.server": {
      classifyPassage: async (_text, candidates) =>
        candidates.map((c) => ({ ...c, relation, explanation: "Synthetic test comparison" })),
    },
    "./embed.server": {
      embedAll: async (texts) => {
        if (beforeEmbedding) await beforeEmbedding();
        return {
          vectors: texts.map(() => vec),
          stats: { embedded: texts.length, batches: 1, retries: 0 },
        };
      },
      toVectorLiteral: JSON.stringify,
    },
    "@/lib/knowledge/embed.server": {
      embedQuery: async () => vec,
      toVectorLiteral: JSON.stringify,
    },
    "@/lib/knowledge/process.server": {
      serializePages: (pages) => pages.map((p) => p.text).join("\f"),
    },
  };
  const review = load("src/lib/knowledge/review.server.ts", mocks);
  mocks["./review.server"] = review;
  const processing = load("src/lib/knowledge/process.server.ts", mocks);
  // Load the actual services to exercise activation/scope/publication behavior.
  mocks["@/lib/knowledge/review.server"] = review;
  const knowledge = load("src/lib/services/knowledge.service.ts", mocks);
  const retrieval = load("src/lib/services/retrieval.service.ts", mocks);
  const library = load("src/lib/services/library.service.ts", mocks);
  async function document(content, options = {}) {
    const id = randomUUID(),
      chunkId = randomUUID(),
      department = options.dept ?? dept;
    await db.query(
      `INSERT INTO knowledge_documents(id,department_id,title,file_name,file_type,file_size_bytes,checksum,
      status,chunk_count,extracted_text,supersedes_id) VALUES ($1,$2,$3,'fixture.txt','txt',1,$4,$5,1,$6,$7)`,
      [
        id,
        department,
        options.title ?? "Synthetic policy",
        id,
        options.status ?? "active",
        content,
        options.supersedes ?? null,
      ],
    );
    if (options.status === "pending_review")
      await db.query(`UPDATE knowledge_documents SET review_state='queued' WHERE id=$1`, [id]);
    await db.query(
      `INSERT INTO knowledge_chunks(id,document_id,department_id,chunk_index,content,embedding,is_searchable)
      VALUES ($1,$2,$3,0,$4,$5::vector,$6)`,
      [chunkId, id, department, content, literal, options.status !== "pending_review"],
    );
    return { id, chunkId };
  }
  return {
    db,
    review,
    processing,
    knowledge,
    retrieval,
    library,
    document,
    admin,
    leader,
    dept,
    shared,
    other,
    setRelation: (value) => {
      relation = value;
    },
    setBeforeEmbedding: (callback) => {
      beforeEmbedding = callback;
    },
    migration,
  };
}

test("review decisions require comparison, confirmation, and exact source excerpts", () => {
  assert.throws(
    () => policy.validateDecision({ kind: null, decision: "include", content: "x" }),
    /Compare/,
  );
  assert.throws(
    () =>
      policy.validateDecision({ kind: "conflict", decision: "include", content: "x", note: "yes" }),
    /explicit/,
  );
  assert.throws(
    () => policy.validateDecision({ kind: "conflict", decision: "use_incoming", content: "x" }),
    /confirmation/,
  );
  assert.throws(
    () =>
      policy.validateDecision({
        kind: "overlap",
        decision: "excerpt",
        content: "A. New rule.",
        excerpt: "Invented rule.",
        note: "approved",
      }),
    /exact/,
  );
  assert.equal(
    policy.validateDecision({
      kind: "overlap",
      decision: "excerpt",
      content: "A. New rule.",
      excerpt: "New rule.",
      note: "approved",
    }),
    "New rule.",
  );
  assert.throws(
    () =>
      policy.validateDecision({
        kind: "duplicate",
        decision: "distinct",
        content: "x",
        note: "yes",
      }),
    /twice/,
  );
});

test("missing comparison providers fail closed as uncertain", async () => {
  const classify = load("src/lib/knowledge/classify.server.ts", {
    "@/lib/ai/providers.server": { resolveProviderChain: () => [] },
  });
  const matches = await classify.classifyPassage("Synthetic new rule", [
    { chunk_id: "candidate", content: "Synthetic current rule" },
  ]);
  assert.equal(matches[0].relation, "uncertain");
});

test("migration is repeatable and existing knowledge stays available", async (t) => {
  const f = await fixture(t);
  await f.db.exec(f.migration.slice(0, f.migration.indexOf("BEGIN;")));
  await f.db.exec(f.migration.slice(f.migration.indexOf("BEGIN;")));
  const doc = await f.document("Synthetic existing guidance");
  const chunks = await f.retrieval.retrieve({ query: "guidance", departmentId: f.dept });
  assert.equal(chunks[0].document_id, doc.id);
});

test("new upload cannot activate or publish while conflicts remain unresolved", async (t) => {
  const f = await fixture(t);
  await f.document("Synthetic leave: 10 days");
  const incoming = await f.document("Synthetic leave: 15 days", { status: "pending_review" });
  const start = await f.review.startReview(incoming.id, f.admin, request);
  await f.review.compareNext(incoming.id, f.admin);
  const report = await f.review.getReview(incoming.id, f.admin);
  assert.equal(report.items[0].kind, "conflict");
  assert.equal(report.unresolved, 1);
  await assert.rejects(
    f.knowledge.setStatus(incoming.id, "active", f.admin, request),
    /comparison/,
  );
  await assert.rejects(
    f.review.publish(incoming.id, start.review_run, f.admin, request),
    /Resolve every/,
  );
  const results = await f.retrieval.retrieve({ query: "leave", departmentId: f.dept });
  assert.equal(results.length, 1);
  assert.notEqual(results[0].document_id, incoming.id);
});

test("keeping equivalent existing guidance prevents duplicate indexing", async (t) => {
  const f = await fixture(t);
  f.setRelation("duplicate");
  const old = await f.document("Synthetic annual leave is 10 days");
  const incoming = await f.document("Synthetic yearly leave: ten days", {
    status: "pending_review",
  });
  const start = await f.review.startReview(incoming.id, f.admin, request);
  await f.review.compareNext(incoming.id, f.admin);
  await f.review.decide(
    incoming.id,
    {
      run: start.review_run,
      chunkId: incoming.chunkId,
      decision: "keep_existing",
      note: "Owner confirms equivalence",
    },
    f.admin,
    request,
  );
  await f.review.publish(incoming.id, start.review_run, f.admin, request);
  const results = await f.retrieval.retrieve({ query: "leave", departmentId: f.dept });
  assert.equal(results.length, 1);
  assert.equal(results[0].document_id, old.id);
  assert.equal((await f.knowledge.getById(incoming.id)).status, "inactive");
});

test("approved correction removes old guidance and records reviewer audit", async (t) => {
  const f = await fixture(t);
  const old = await f.document("Synthetic approval limit: 100");
  const incoming = await f.document("Synthetic approval limit: 200", { status: "pending_review" });
  const start = await f.review.startReview(incoming.id, f.admin, request);
  await f.review.compareNext(incoming.id, f.admin);
  await f.review.decide(
    incoming.id,
    {
      run: start.review_run,
      chunkId: incoming.chunkId,
      decision: "use_incoming",
      note: "Synthetic owner confirmed 200",
    },
    f.admin,
    request,
  );
  await f.review.publish(incoming.id, start.review_run, f.admin, request);
  const results = await f.retrieval.retrieve({ query: "approval", departmentId: f.dept });
  assert.equal(results.length, 1);
  assert.equal(results[0].content, "Synthetic approval limit: 200");
  const oldSearch = await f.retrieval.retrieve({ query: "approval", documentId: old.id });
  assert.equal(oldSearch.length, 0);
  const audits = await f.db.query(`SELECT action,actor_id FROM audit_logs WHERE record_id=$1`, [
    incoming.id,
  ]);
  assert.ok(
    audits.rows.some(
      (r) => r.action === "knowledge.review_published" && r.actor_id === f.admin.userId,
    ),
  );
});

test("new exact excerpt keeps original upload and indexes only selected text", async (t) => {
  const f = await fixture(t);
  f.setRelation("overlap");
  await f.document("Synthetic existing rule.");
  const incoming = await f.document("Synthetic existing rule. New synthetic procedure.", {
    status: "pending_review",
  });
  const start = await f.review.startReview(incoming.id, f.admin, request);
  await f.review.compareNext(incoming.id, f.admin);
  await f.review.decide(
    incoming.id,
    {
      run: start.review_run,
      chunkId: incoming.chunkId,
      decision: "excerpt",
      excerpt: "New synthetic procedure.",
      note: "Owner confirms new procedure",
    },
    f.admin,
    request,
  );
  await f.review.publish(incoming.id, start.review_run, f.admin, request);
  const results = await f.retrieval.retrieve({ query: "procedure", documentId: incoming.id });
  assert.equal(results[0].content, "New synthetic procedure.");
  const original = await f.db.query(`SELECT content FROM knowledge_chunks WHERE id=$1`, [
    incoming.chunkId,
  ]);
  assert.equal(original.rows[0].content, "Synthetic existing rule. New synthetic procedure.");
});

test("existing-document scan quarantines both sides until reviewed publication", async (t) => {
  const f = await fixture(t);
  const a = await f.document("Synthetic deadline: 5 days"),
    b = await f.document("Synthetic deadline: 7 days");
  const start = await f.review.startReview(a.id, f.admin, request);
  await f.review.compareNext(a.id, f.admin);
  assert.equal((await f.retrieval.retrieve({ query: "deadline", departmentId: f.dept })).length, 0);
  await f.review.decide(
    a.id,
    {
      run: start.review_run,
      chunkId: a.chunkId,
      decision: "keep_existing",
      note: "Owner confirms the other source",
    },
    f.admin,
    request,
  );
  assert.equal((await f.retrieval.retrieve({ query: "deadline", departmentId: f.dept })).length, 0);
  await f.review.publish(a.id, start.review_run, f.admin, request);
  const results = await f.retrieval.retrieve({ query: "deadline", departmentId: f.dept });
  assert.equal(results.length, 1);
  assert.equal(results[0].document_id, b.id);
});

test("leader cannot access other departments or supersede shared guidance", async (t) => {
  const f = await fixture(t);
  const inaccessible = await f.document("Synthetic private rule", { dept: f.other });
  await assert.rejects(f.review.getReview(inaccessible.id, f.leader), /not found/);
  await f.document("Synthetic company-wide rule", { dept: f.shared });
  const incoming = await f.document("Synthetic conflicting department rule", {
    status: "pending_review",
  });
  const start = await f.review.startReview(incoming.id, f.leader, request);
  await f.review.compareNext(incoming.id, f.leader);
  await assert.rejects(
    f.review.decide(
      incoming.id,
      {
        run: start.review_run,
        chunkId: incoming.chunkId,
        decision: "use_incoming",
        note: "Approve",
      },
      f.leader,
      request,
    ),
    /admin must approve/,
  );
  await assert.rejects(
    f.review.getReview(incoming.id, { ...f.leader, departmentId: null }),
    /not found/,
  );
});

test("live knowledge changes invalidate publication and reviewer decisions", async (t) => {
  const f = await fixture(t);
  f.setRelation("new");
  const incoming = await f.document("Synthetic new guidance", { status: "pending_review" });
  const start = await f.review.startReview(incoming.id, f.admin, request);
  await f.review.compareNext(incoming.id, f.admin);
  await f.document("Synthetic policy added after comparison");
  await assert.rejects(
    f.review.publish(incoming.id, start.review_run, f.admin, request),
    /knowledge changed/,
  );
  await assert.rejects(
    f.review.decide(
      incoming.id,
      { run: start.review_run, chunkId: incoming.chunkId, decision: "include" },
      f.admin,
      request,
    ),
    /Knowledge changed/,
  );
});

test("superseding another scanned document prevents its old review restoring removed guidance", async (t) => {
  const f = await fixture(t);
  const a = await f.document("Synthetic threshold: 1"),
    b = await f.document("Synthetic threshold: 2");
  const reviewA = await f.review.startReview(a.id, f.admin, request);
  const reviewB = await f.review.startReview(b.id, f.admin, request);
  await f.review.compareNext(a.id, f.admin);
  await f.review.compareNext(b.id, f.admin);
  await f.review.decide(
    a.id,
    {
      run: reviewA.review_run,
      chunkId: a.chunkId,
      decision: "use_incoming",
      note: "Owner confirms threshold 1",
    },
    f.admin,
    request,
  );
  await f.review.publish(a.id, reviewA.review_run, f.admin, request);
  await assert.rejects(
    f.review.publish(b.id, reviewB.review_run, f.admin, request),
    /knowledge changed/,
  );
});

test("replacement archives the old version only after reviewed publication", async (t) => {
  const f = await fixture(t);
  f.setRelation("duplicate");
  const old = await f.document("Synthetic policy version 1");
  const incoming = await f.document("Synthetic policy version 2", {
    status: "pending_review",
    supersedes: old.id,
  });
  assert.equal((await f.knowledge.getById(old.id)).status, "active");
  const start = await f.review.startReview(incoming.id, f.admin, request);
  await f.review.compareNext(incoming.id, f.admin);
  await f.review.decide(
    incoming.id,
    {
      run: start.review_run,
      chunkId: incoming.chunkId,
      decision: "keep_existing",
      note: "same content",
    },
    f.admin,
    request,
  );
  await assert.rejects(
    f.review.publish(incoming.id, start.review_run, f.admin, request),
    /kept source/,
  );
  await f.review.decide(
    incoming.id,
    {
      run: start.review_run,
      chunkId: incoming.chunkId,
      decision: "use_incoming",
      note: "Owner approves replacement",
    },
    f.admin,
    request,
  );
  await f.review.publish(incoming.id, start.review_run, f.admin, request);
  assert.equal((await f.knowledge.getById(old.id)).status, "archived");
  assert.equal((await f.knowledge.getById(incoming.id)).status, "active");
});

test("the real processing pipeline queues review and never activates uploaded content", async (t) => {
  const f = await fixture(t);
  const doc = await f.document("Synthetic new upload for processing", { status: "processing" });
  await f.processing.processDocument(doc.id);
  const stored = await f.knowledge.getById(doc.id);
  assert.equal(stored.status, "pending_review");
  const report = await f.review.getReview(doc.id, f.admin);
  assert.equal(report.total, 1);
  assert.equal(report.compared, 1);
  assert.equal((await f.retrieval.retrieve({ query: "upload", departmentId: f.dept })).length, 0);
  await assert.rejects(f.processing.processDocument(doc.id), /not queued/);
});

test("an incomplete model comparison cannot silently approve unclassified candidates", async () => {
  const classifier = load("src/lib/knowledge/classify.server.ts", {
    "@/lib/ai/providers.server": { resolveProviderChain: () => [{ model: {} }] },
    ai: { generateObject: async () => ({ object: { comparisons: [] } }) },
  });
  const rows = await classifier.classifyPassage("Synthetic incoming rule", [
    { chunk_id: "old", content: "Synthetic source" },
  ]);
  assert.equal(rows[0].relation, "uncertain");
});

test("resource reading and document-scoped chat cannot recover superseded source text", async (t) => {
  const f = await fixture(t);
  f.setRelation("overlap");
  await f.document("Synthetic current leave policy");
  const incoming = await f.document("Synthetic duplicated leave policy. New synthetic procedure.", {
    status: "pending_review",
  });
  const start = await f.review.startReview(incoming.id, f.admin, request);
  await f.review.compareNext(incoming.id, f.admin);
  await f.review.decide(
    incoming.id,
    {
      run: start.review_run,
      chunkId: incoming.chunkId,
      decision: "excerpt",
      excerpt: "New synthetic procedure.",
      note: "Confirmed new procedure",
    },
    f.admin,
    request,
  );
  await f.review.publish(incoming.id, start.review_run, f.admin, request);
  const resource = await f.library.getResource(incoming.id, null);
  assert.equal(resource.pages.join("\n"), "New synthetic procedure.");
  const chunks = await f.knowledge.listChunks(incoming.id);
  assert.equal(chunks.items[0].content, "New synthetic procedure.");
  assert.equal(chunks.items[0].is_searchable, true);
});

test("restarting a fully superseded scan clears its stale quarantine without restoring old guidance", async (t) => {
  const f = await fixture(t);
  const a = await f.document("Synthetic threshold: 1"),
    b = await f.document("Synthetic threshold: 2");
  const ra = await f.review.startReview(a.id, f.admin, request);
  await f.review.startReview(b.id, f.admin, request);
  await f.review.compareNext(a.id, f.admin);
  await f.review.compareNext(b.id, f.admin);
  await f.review.decide(
    a.id,
    {
      run: ra.review_run,
      chunkId: a.chunkId,
      decision: "use_incoming",
      note: "Owner confirms threshold 1",
    },
    f.admin,
    request,
  );
  await f.review.publish(a.id, ra.review_run, f.admin, request);
  await f.review.startReview(b.id, f.admin, request);
  const rows = await f.retrieval.retrieve({ query: "threshold", departmentId: f.dept });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].document_id, a.id);
  assert.equal((await f.knowledge.getById(b.id)).status, "inactive");
});

test("an expired processing worker cannot overwrite or fail a newer attempt", async (t) => {
  const f = await fixture(t);
  const doc = await f.document("Synthetic queued document", { status: "processing" });
  f.setBeforeEmbedding(async () => {
    await f.db.query(
      "UPDATE knowledge_documents SET processing_attempts=processing_attempts+1 WHERE id=$1",
      [doc.id],
    );
  });
  await assert.rejects(f.processing.processDocument(doc.id), /cancelled/);
  const row = await f.knowledge.getById(doc.id);
  assert.equal(row.status, "processing");
  assert.equal(row.processing_attempts, 2);
});
