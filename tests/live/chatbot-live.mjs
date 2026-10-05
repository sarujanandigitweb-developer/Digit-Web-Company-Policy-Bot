// Live check: real model calls and real embeddings against an ISOLATED local database
// (PGlite) with SYNTHETIC documents. Not part of `npm test`: it needs network access
// and provider keys, which are read from .env at runtime and never printed.
//
//   node tests/live/chatbot-live.mjs
//
// Real: embeddings, the classifier, review/scan/publication, retrieval, the conflict
// disclosure, the chat prompt builder and the model response. Replaced: only the
// database connection, which points at a throwaway in-memory PostgreSQL.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const require = createRequire(import.meta.url);
const root = new URL("../../", import.meta.url);
const rootPath = root.pathname.replace(/^\/([A-Za-z]:)/, "$1");
const source = (path) => readFileSync(new URL(path, root), "utf8");

// Load provider keys from .env into the environment. Values are never logged.
if (existsSync(new URL(".env", root))) {
  for (const line of source(".env").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && match[2].trim() && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

function load(path, mocks = {}, cache = new Map()) {
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  cache.set(path, module.exports);
  const localRequire = (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`, mocks, cache);
    if (name.startsWith("."))
      return load(new URL(`${name}.ts`, new URL(path, root)).pathname.slice(root.pathname.length), mocks, cache);
    return require(name);
  };
  const js = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("module", "exports", "require", js)(module, module.exports, localRequire);
  cache.set(path, module.exports);
  return module.exports;
}

const db = await PGlite.create({ extensions: { vector, pg_trgm } });
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
  withTransaction: (fn) => db.transaction((tx) => fn({ query: (text, params) => query(tx, text, params) })),
};

const mocks = { "@/lib/db/client.server": database };
const embed = load("src/lib/knowledge/embed.server.ts", mocks);
mocks["@/lib/knowledge/embed.server"] = embed;
mocks["./embed.server"] = embed;
const classify = load("src/lib/knowledge/classify.server.ts", mocks);
mocks["./classify.server"] = classify;
const review = load("src/lib/knowledge/review.server.ts", mocks);
mocks["./review.server"] = review;
mocks["@/lib/knowledge/review.server"] = review;
const scan = load("src/lib/knowledge/conflict-scan.server.ts", mocks);
const processing = load("src/lib/knowledge/process.server.ts", mocks);
const notice = load("src/lib/knowledge/conflict-notice.server.ts", mocks);
mocks["@/lib/knowledge/conflict-notice.server"] = notice;
const retrieval = load("src/lib/services/retrieval.service.ts", mocks);
mocks["./retrieval.service"] = retrieval;
const chat = load("src/lib/services/chat-knowledge.server.ts", mocks);
const gateway = load("src/lib/ai/gateway.server.ts", mocks);

const adminId = randomUUID();
const hr = randomUUID();
await db.query(`INSERT INTO departments(id,slug,name,is_shared) VALUES ($1,'hr','HR',false)`, [hr]);
await db.query(`INSERT INTO neon_auth."user"(id,email) VALUES ($1,'admin@example.test')`, [adminId]);
await db.query(`INSERT INTO profiles(user_id,role,department_id) VALUES ($1,'admin',NULL)`, [adminId]);
const admin = { userId: adminId, role: "admin", departmentId: null };
const request = new Request("http://localhost/live", { method: "POST" });

// Approved synthetic documents. Real embeddings are computed for every passage.
async function approved(title, content) {
  const id = randomUUID();
  const [vectorValues] = await embed.embedAll([content], "RETRIEVAL_DOCUMENT").then((r) => r.vectors);
  await db.query(
    `INSERT INTO knowledge_documents(id,department_id,title,file_name,file_type,file_size_bytes,checksum,status,chunk_count,extracted_text)
     VALUES ($1,$2,$3,'synthetic.txt','txt',1,$4,'active',1,$5)`,
    [id, hr, title, randomUUID(), content],
  );
  await db.query(
    `INSERT INTO knowledge_chunks(id,document_id,department_id,chunk_index,content,embedding,is_searchable)
     VALUES ($1,$2,$3,0,$4,$5::vector,true)`,
    [randomUUID(), id, hr, content, embed.toVectorLiteral(vectorValues)],
  );
  return id;
}

const docs = {
  leave: await approved("Synthetic leave handbook", "Synthetic leave rule: employees accrue 2 leave days for each month of service."),
  roomsGuide: await approved("Synthetic meeting room guide", "Synthetic meeting room rule: rooms may be booked 7 days in advance."),
  roomsMemo: await approved("Synthetic meeting room memo", "Synthetic meeting room rule: rooms may be booked 14 days in advance."),
};

async function completeScan() {
  const started = await scan.startScan(admin, request);
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const step = await scan.stepScan(started.id, cursor, admin, request);
    if (step.done) return started.id;
    cursor = step.cursor;
  }
  throw new Error("scan did not finish");
}

async function answer(question) {
  const context = await chat.buildKnowledgeContext({
    question,
    departmentId: hr,
    globalSearch: false,
  });
  const stream = await gateway.streamChatBody({
    system: context.system,
    messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: question }] }],
  });
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === "text-delta" && value.delta) text += value.delta;
  }
  return {
    text: text.trim(),
    disclosed: context.system.includes("UNRESOLVED CONFLICT"),
    retrieved: context.chunks.map((c) => c.document_title),
  };
}

const results = [];
function record(step, question, result, expectation) {
  results.push({ step, question, expectation, answer: result.text.slice(0, 400), disclosed: result.disclosed, retrieved: [...new Set(result.retrieved)] });
}

// 0. Calibration evidence: real similarity between each question and each approved passage.
const calibrationQuestions = [
  "How many leave days do employees accrue each month?",
  "How many days in advance can meeting rooms be booked?",
  "What is the company policy on dinosaur parking?",
];
const calibration = [];
for (const question of calibrationQuestions) {
  const queryVector = await embed.embedQuery(question);
  const rows = await db.query(
    `SELECT d.title, round((1 - (c.embedding <=> $1::vector))::numeric, 3) AS similarity
       FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
      WHERE c.is_searchable ORDER BY c.embedding <=> $1::vector`,
    [embed.toVectorLiteral(queryVector)],
  );
  calibration.push({ question, similarities: rows.rows.map((r) => `${r.title}: ${r.similarity}`) });
}
results.push({ step: "0 calibration", calibration });

// 1. Existing knowledge with a real library scan (real classifier).
const scanId = await completeScan();
const scanStatus = await scan.getScan(scanId);
results.push({ step: "1 library scan", findings: scanStatus.counts, scanComplete: scanStatus.scan.status === "complete" });

// 2. Chatbot answers before any decision.
record("2a supported", "How many leave days do employees accrue each month?", await answer("How many leave days do employees accrue each month?"), "answers 2 from the leave handbook");
record("2b conflict", "How many days in advance can meeting rooms be booked?", await answer("How many days in advance can meeting rooms be booked?"), "discloses the disagreement, names no single answer as the rule");
record("2c unsupported", "What is the company policy on dinosaur parking?", await answer("What is the company policy on dinosaur parking?"), "does not invent a policy");

// 3. A new upload that claims a third value stays out until reviewed.
const pendingId = randomUUID();
await db.query(
  `INSERT INTO knowledge_documents(id,department_id,title,file_name,file_type,file_size_bytes,checksum,status,extracted_text)
   VALUES ($1,$2,'Synthetic meeting room update','synthetic.txt','txt',1,$3,'processing',$4)`,
  [pendingId, hr, randomUUID(), "Synthetic meeting room rule: rooms may be booked 30 days in advance."],
);
await processing.processDocument(pendingId, { size: 600, overlap: 0 });
const pendingStatus = (await db.query(`SELECT status FROM knowledge_documents WHERE id=$1`, [pendingId])).rows[0].status;
const pendingSearchable = (await db.query(`SELECT count(*)::int AS n FROM knowledge_search_chunks WHERE document_id=$1`, [pendingId])).rows[0].n;
results.push({ step: "3 pending upload", status: pendingStatus, searchablePassages: pendingSearchable });
record("3 pending upload", "How many days in advance can meeting rooms be booked?", await answer("How many days in advance can meeting rooms be booked?"), "must not mention 30 days or the pending upload title");

// 4. Resolve the conflict through the memo's own review: accept the guide's 7-day rule
//    (a reviewer decision), leaving the guide and all unrelated passages intact.
const memoChunk = (await db.query(`SELECT id FROM knowledge_chunks WHERE document_id=$1`, [docs.roomsMemo])).rows[0].id;
const started = await review.startReview(docs.roomsMemo, admin, request);
for (let i = 0; i < 20; i++) {
  const report = await review.getReview(docs.roomsMemo, admin);
  if (report.compared >= report.total) break;
  await review.compareNext(docs.roomsMemo, admin);
}
const memoReport = await review.getReview(docs.roomsMemo, admin);
const memoItem = memoReport.items.find((item) => item.chunk_id === memoChunk);
results.push({ step: "4a review kind of memo passage", kind: memoItem?.kind ?? null });
await review.decide(docs.roomsMemo, { run: started.review_run, chunkId: memoChunk, decision: "keep_existing", note: "Synthetic: policy owner keeps the guide's 7-day rule" }, admin, request);
await review.publish(docs.roomsMemo, started.review_run, admin, request);
const guideStillSearchable = (await db.query(`SELECT is_searchable FROM knowledge_chunks WHERE document_id=$1`, [docs.roomsGuide])).rows[0].is_searchable;
const memoStatus = (await db.query(`SELECT status FROM knowledge_documents WHERE id=$1`, [docs.roomsMemo])).rows[0].status;
results.push({ step: "4b after publishing keep_existing", guideSearchable: guideStillSearchable, memoStatus });
record("4c after decision", "How many days in advance can meeting rooms be booked?", await answer("How many days in advance can meeting rooms be booked?"), "answers 7 days from the guide; no conflict notice remains");

console.log(JSON.stringify(results, null, 2));
await db.close();
