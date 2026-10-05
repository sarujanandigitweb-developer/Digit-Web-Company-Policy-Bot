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

// Content-level publication, end to end, on SYNTHETIC documents. The real upload
// processing, review, publication, retrieval and audit code runs against PostgreSQL
// SQL (PGlite). Only the model and embedding calls are replaced by fixed rules, so
// every decision here is deterministic and reproducible. No company policy is used.
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
 * SYNTHETIC decision rules standing in for the model. Each incoming passage is
 * classified by a fixed, visible rule so the expected outcome is known in advance.
 */
function syntheticRelation(incoming, candidate) {
  if (/fourteen days/.test(incoming) && /14 days/.test(candidate)) return "duplicate";
  if (/45 days/.test(incoming) && /30 days/.test(candidate)) return "conflict";
  if (/must include receipts/.test(incoming) && /travel claims/.test(candidate)) return "overlap";
  if (/deadline is 5 days/.test(incoming) && /deadline is 9 days/.test(candidate)) return "conflict";
  return "new";
}

async function fixture(t) {
  const db = await PGlite.create({ extensions: { vector, pg_trgm } });
  t.after(() => db.close());
  await db.exec('CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user"(id uuid PRIMARY KEY,email text);');
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
  const m12 = source("migrations/0012_document_review.sql");
  await db.exec(m12.slice(0, m12.indexOf("BEGIN;")));
  await db.exec(m12.slice(m12.indexOf("BEGIN;")));
  await db.exec(source("migrations/0013_conflict_scan.sql"));
  await db.exec(source("migrations/0014_read_only_existing_scan.sql"));

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
  sql.unsafe = (unsafe) => ({ unsafe });
  const database = {
    sql,
    withTransaction: (fn) =>
      db.transaction((tx) => fn({ query: (text, params) => query(tx, text, params) })),
  };

  const adminId = randomUUID();
  const dept = randomUUID();
  await db.query(`INSERT INTO departments(id,slug,name,is_shared) VALUES ($1,'hr','HR',false)`, [dept]);
  await db.query(`INSERT INTO neon_auth."user"(id,email) VALUES ($1,'admin@example.test')`, [adminId]);
  await db.query(`INSERT INTO profiles(user_id,role,department_id) VALUES ($1,'admin',NULL)`, [adminId]);
  const admin = { userId: adminId, role: "admin", departmentId: null };

  const mocks = {
    "@/lib/db/client.server": database,
    "./classify.server": {
      classifyPassage: async (incoming, candidates) =>
        candidates.map((c) => ({
          ...c,
          relation: syntheticRelation(incoming, c.content),
          explanation: "Synthetic rule",
        })),
    },
    "./embed.server": {
      embedAll: async (texts) => ({
        vectors: texts.map(() => vec),
        stats: { embedded: texts.length, batches: 1, retries: 0 },
      }),
      toVectorLiteral: JSON.stringify,
    },
    "@/lib/knowledge/embed.server": {
      embedQuery: async () => vec,
      toVectorLiteral: JSON.stringify,
    },
  };
  const review = load("src/lib/knowledge/review.server.ts", mocks);
  mocks["./review.server"] = review;
  mocks["@/lib/knowledge/review.server"] = review;
  const processing = load("src/lib/knowledge/process.server.ts", mocks);
  const knowledge = load("src/lib/services/knowledge.service.ts", mocks);
  const retrieval = load("src/lib/services/retrieval.service.ts", mocks);
  const notice = load("src/lib/knowledge/conflict-notice.server.ts", mocks);

  // An already-approved document: its passages are searchable and embedded.
  async function approvedDocument(title, passages) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO knowledge_documents(id,department_id,title,file_name,file_type,file_size_bytes,checksum,
        status,chunk_count,extracted_text) VALUES ($1,$2,$3,'synthetic.txt','txt',1,$4,'active',$5,$6)`,
      [id, dept, title, randomUUID(), passages.length, passages.join("\f")],
    );
    const chunks = [];
    for (const [index, content] of passages.entries()) {
      const chunkId = randomUUID();
      chunks.push(chunkId);
      await db.query(
        `INSERT INTO knowledge_chunks(id,document_id,department_id,chunk_index,content,embedding,is_searchable)
         VALUES ($1,$2,$3,$4,$5,$6::vector,true)`,
        [chunkId, id, dept, index, content, literal],
      );
    }
    return { id, chunks };
  }

  // A new upload: stored and processed by the real pipeline, which leaves it pending.
  async function upload(title, text, extra = {}) {
    const chunking = { size: extra.size ?? 90, overlap: 0 };
    const id = randomUUID();
    await db.query(
      `INSERT INTO knowledge_documents(id,department_id,title,file_name,file_type,file_size_bytes,checksum,
        status,extracted_text,supersedes_id) VALUES ($1,$2,$3,'synthetic.txt','txt',1,$4,'processing',$5,$6)`,
      [id, dept, title, randomUUID(), text, extra.supersedes ?? null],
    );
    await processing.processDocument(id, chunking);
    return id;
  }

  async function auditActions(recordId) {
    const rows = await db.query(
      `SELECT action FROM audit_logs WHERE record_id = $1 ORDER BY id`,
      [recordId],
    );
    return rows.rows.map((r) => r.action);
  }

  return { db, admin, dept, review, processing, knowledge, retrieval, notice, approvedDocument, upload, auditActions };
}

test("mixed upload: new, duplicate, conflicting and compatible claims publish at content level", async (t) => {
  const f = await fixture(t);
  // Existing approved guidance (synthetic).
  const existing = await f.approvedDocument("Synthetic handbook", [
    "Synthetic leave notice is 14 days.",
    "Synthetic travel claims close after 30 days.",
  ]);
  const [leaveNotice, travelClaims] = existing.chunks;

  // Incoming upload with four claims, one per passage.
  const incomingText = [
    "Synthetic badge replacement costs 5 units.",
    "Synthetic leave notice is fourteen days.",
    "Synthetic travel claims close after 45 days.",
    "Synthetic travel claims must include receipts.",
  ].join("\n\n");
  const id = await f.upload("Synthetic mixed upload", incomingText, { size: 60 });

  const pending = await f.db.query(
    `SELECT c.content, c.is_searchable, r.kind, r.decision
       FROM knowledge_chunks c JOIN knowledge_chunk_reviews r ON r.chunk_id=c.id
      WHERE c.document_id=$1 ORDER BY c.chunk_index`,
    [id],
  );
  t.diagnostic(`passages after processing: ${pending.rows.length}`);
  assert.equal(pending.rows.length, 4, "the synthetic document splits into one passage per claim");
  assert.ok(pending.rows.every((r) => r.is_searchable === false), "nothing from the upload is searchable yet");
  const [badge, leaveDup, travelConflict, travelDetail] = pending.rows;
  const earlyHits = await f.retrieval.retrieve({ query: "badge replacement", departmentId: f.dept });
  assert.ok(
    earlyHits.every((r) => r.document_id !== id),
    "an unapproved upload never reaches retrieval",
  );

  // Review: compare every passage, then decide each one explicitly.
  const run = (await f.db.query(`SELECT review_run FROM knowledge_documents WHERE id=$1`, [id])).rows[0]
    .review_run;
  for (let i = 0; i < 10; i++) {
    const report = await f.review.getReview(id, f.admin);
    if (report.compared >= report.total) break;
    await f.review.compareNext(id, f.admin);
  }
  const report = await f.review.getReview(id, f.admin);
  const byText = Object.fromEntries(report.items.map((item) => [item.incoming_content, item]));
  assert.equal(byText["Synthetic badge replacement costs 5 units."].kind, "new");
  assert.equal(byText["Synthetic leave notice is fourteen days."].kind, "duplicate");
  assert.equal(byText["Synthetic travel claims close after 45 days."].kind, "conflict");
  assert.equal(
    byText["Synthetic travel claims must include receipts."].kind,
    "overlap",
  );

  const decide = (chunkId, decision, extra = {}) =>
    f.review.decide(id, { run, chunkId, decision, ...extra }, f.admin, new Request("http://t/x"));
  await decide(
    travelConflict.chunk_id ?? (await chunkIdFor(f, id, "Synthetic travel claims close after 45 days.")),
    "unresolved",
    { note: "Policy owner has not yet confirmed the travel deadline" },
  );
  await decide(await chunkIdFor(f, id, "Synthetic leave notice is fourteen days."), "keep_existing", {
    note: "Same rule already approved",
  });
  await decide(
    await chunkIdFor(f, id, "Synthetic travel claims must include receipts."),
    "excerpt",
    { note: "Receipt requirement is approved as an addition to the travel rule", excerpt: "Synthetic travel claims must include receipts." },
  );
  // The new claim has no candidate, so it is included with no decision needed.
  const beforePublish = await f.retrieval.retrieve({ query: "leave notice", departmentId: f.dept });
  assert.ok(beforePublish.every((r) => r.document_id !== id), "decisions alone do not publish");

  await f.review.publish(id, run, f.admin, new Request("http://t/x"));

  // Evidence: what the chatbot can now retrieve.
  const chunksAfter = await f.db.query(
    `SELECT c.content, c.approved_content, c.is_searchable FROM knowledge_chunks c
      WHERE c.document_id=$1 ORDER BY c.chunk_index`,
    [id],
  );
  t.diagnostic(
    `upload passages after publish: ${JSON.stringify(
      chunksAfter.rows.map((r) => ({ searchable: r.is_searchable, text: r.approved_content ?? r.content })),
    )}`,
  );
  const [newClaim, dupClaim, conflictClaim, detailClaim] = chunksAfter.rows;
  assert.equal(newClaim.is_searchable, true, "new claim is published");
  assert.equal(dupClaim.is_searchable, false, "duplicate is not indexed a second time");
  assert.equal(conflictClaim.is_searchable, false, "unresolved conflict stays out");
  assert.equal(detailClaim.is_searchable, true, "compatible detail is published");
  assert.equal(
    detailClaim.approved_content,
    "Synthetic travel claims must include receipts.",
    "only the approved additional detail is searchable, not the repeated deadline",
  );

  const retrieved = async (query) =>
    (await f.retrieval.retrieve({ query, departmentId: f.dept })).map((r) => r.content);
  const badgeHits = await retrieved("badge replacement cost");
  assert.ok(badgeHits.some((c) => /badge replacement/.test(c)), "new claim is retrievable");
  const leaveHits = await retrieved("leave notice fourteen days");
  assert.equal(leaveHits.filter((c) => /notice is/.test(c)).length, 1, "one copy of the leave rule");
  assert.ok(!leaveHits.some((c) => /fourteen/.test(c)), "the duplicate wording is not retrievable");
  const travelHits = await retrieved("travel claims close after 45 days");
  assert.ok(!travelHits.some((c) => /45 days/.test(c)), "the rejected conflicting claim never appears");
  const receiptHits = await retrieved("travel claims receipts");
  assert.ok(receiptHits.some((c) => c === "Synthetic travel claims must include receipts."));
  assert.equal(
    receiptHits.filter((c) => /travel claims/.test(c)).length,
    2,
    "the existing deadline and the approved receipt detail are kept as separate claims",
  );

  // The unresolved conflict is disclosed, by title only.
  const disclosed = await f.notice.openConflicts({
    question: "travel claims deadline",
    departmentId: f.dept,
    globalSearch: false,
    threshold: 0.5,
  });
  assert.ok(
    disclosed.some((c) => [c.titleA, c.titleB].includes("Synthetic mixed upload")),
    "the withheld conflicting claim is disclosed by title",
  );

  // Audit: the publication, and every decision that caused it.
  const actions = await f.auditActions(id);
  assert.ok(actions.includes("knowledge.review_published"), "publication is audited");
  assert.ok(actions.filter((a) => a === "knowledge.review_decided").length >= 3, "each decision is audited");
});

test("accepting a replacement supersedes only the affected claim and keeps unrelated content", async (t) => {
  const f = await fixture(t);
  const existing = await f.approvedDocument("Synthetic handbook v1", [
    "Synthetic leave notice is 14 days.",
    "Synthetic travel claims close after 30 days.",
  ]);
  const replacement = await f.upload("Synthetic handbook v2", "Synthetic travel claims close after 45 days.", {
    supersedes: existing.id,
  });
  const run = (await f.db.query(`SELECT review_run FROM knowledge_documents WHERE id=$1`, [replacement]))
    .rows[0].review_run;
  for (let i = 0; i < 5; i++) {
    const report = await f.review.getReview(replacement, f.admin);
    if (report.compared >= report.total) break;
    await f.review.compareNext(replacement, f.admin);
  }
  const report = await f.review.getReview(replacement, f.admin);
  assert.equal(report.items[0].kind, "conflict");
  await f.review.decide(
    replacement,
    { run, chunkId: report.items[0].chunk_id, decision: "use_incoming", note: "Owner confirms the 45-day rule" },
    f.admin,
    new Request("http://t/x"),
  );
  await f.review.publish(replacement, run, f.admin, new Request("http://t/x"));

  const leave = (await f.db.query(`SELECT is_searchable FROM knowledge_chunks WHERE id=$1`, [existing.chunks[0]]))
    .rows[0];
  const travel = (await f.db.query(`SELECT is_searchable FROM knowledge_chunks WHERE id=$1`, [existing.chunks[1]]))
    .rows[0];
  assert.equal(leave.is_searchable, true, "unrelated leave rule stays available");
  assert.equal(travel.is_searchable, false, "only the superseded travel claim is withdrawn");
  assert.equal((await f.knowledge.getById(existing.id)).status, "active", "the old version stays live while it has content");
  const hits = await f.retrieval.retrieve({ query: "leave notice", departmentId: f.dept });
  assert.ok(hits.some((r) => r.document_id === existing.id), "the unrelated rule is still answered from the old version");
  const travelHits = await f.retrieval.retrieve({ query: "travel claims close after", departmentId: f.dept });
  assert.ok(!travelHits.some((r) => r.content.includes("30 days")), "the superseded claim is gone");
  assert.ok(travelHits.some((r) => r.content.includes("45 days")), "the accepted replacement is answered");
});

test("an active document is resolved through its own review, leaving unrelated passages intact", async (t) => {
  const f = await fixture(t);
  // Two approved documents that disagree. Neither is an upload.
  const a = await f.approvedDocument("Synthetic rule A", [
    "Synthetic deadline is 5 days.",
    "Synthetic unrelated rule about badges.",
  ]);
  const b = await f.approvedDocument("Synthetic rule B", ["Synthetic deadline is 9 days."]);
  // A library-wide scan would find this pair. Here the pair is recorded directly,
  // because the scan itself is covered by its own tests.
  const scanId = randomUUID();
  await f.db.query(
    `INSERT INTO knowledge_conflict_scans(id,status,chunks_total,chunks_done) VALUES ($1,'complete',3,3)`,
    [scanId],
  );
  const [low, high] = [a.chunks[0], b.chunks[0]].sort();
  await f.db.query(
    `INSERT INTO knowledge_pair_comparisons(chunk_low,chunk_high,relation,explanation,scan_id) VALUES ($1,$2,'conflict','Synthetic',$3)`,
    [low, high, scanId],
  );

  // Resolve from document A's review: keep A's rule, retire B's passage in full.
  const start = await f.review.startReview(a.id, f.admin, new Request("http://t/x"));
  assert.equal((await f.knowledge.getById(a.id)).status, "active", "scanning an active document keeps it active");
  for (let i = 0; i < 5; i++) {
    const report = await f.review.getReview(a.id, f.admin);
    if (report.compared >= report.total) break;
    await f.review.compareNext(a.id, f.admin);
  }
  const report = await f.review.getReview(a.id, f.admin);
  const deadline = report.items.find((item) => item.incoming_content.includes("deadline"));
  assert.equal(deadline.kind, "conflict");
  await f.review.decide(
    a.id,
    { run: start.review_run, chunkId: deadline.chunk_id, decision: "use_incoming", note: "Owner confirms 5 days" },
    f.admin,
    new Request("http://t/x"),
  );
  await f.review.publish(a.id, start.review_run, f.admin, new Request("http://t/x"));

  const bChunk = (await f.db.query(`SELECT is_searchable FROM knowledge_chunks WHERE id=$1`, [b.chunks[0]])).rows[0];
  const aBadges = (await f.db.query(`SELECT is_searchable FROM knowledge_chunks WHERE id=$1`, [a.chunks[1]])).rows[0];
  assert.equal(bChunk.is_searchable, false, "the conflicting passage in B is withheld");
  assert.equal(aBadges.is_searchable, true, "unrelated passages in A are preserved");
  assert.equal((await f.knowledge.getById(b.id)).status, "inactive", "B, fully withheld, is inactive by decision");
  assert.equal((await f.knowledge.getById(a.id)).status, "active");
  const hits = await f.retrieval.retrieve({ query: "deadline days", departmentId: f.dept });
  assert.ok(hits.every((h) => h.document_id === a.id), "only A's rule can be retrieved");
  const actions = await f.auditActions(a.id);
  assert.ok(actions.includes("knowledge.review_decided") && actions.includes("knowledge.review_published"));
});

async function chunkIdFor(f, documentId, content) {
  const rows = await f.db.query(
    `SELECT c.id FROM knowledge_chunks c WHERE c.document_id=$1 AND c.content=$2`,
    [documentId, content],
  );
  return rows.rows[0].id;
}
