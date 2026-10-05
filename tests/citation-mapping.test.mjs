import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// Saves two answers in one chat session with DIFFERENT passages, then reads the
// stored citations back. Checks that each stored rank still points at the passage
// that answer's [n] marker referred to, and that no answer picks up another's sources.
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
    if (name.startsWith(".")) return load(new URL(`${name}.ts`, new URL(path, root)).pathname.slice(root.pathname.length), mocks, cache);
    return require(name);
  };
  const js = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("module", "exports", "require", js)(module, module.exports, localRequire);
  cache.set(path, module.exports);
  return module.exports;
}

const vec = [1, ...Array(1535).fill(0)];

test("stored citation ranks map to the same passages the answer's [n] markers used", async (t) => {
  const db = await PGlite.create({ extensions: { vector, pg_trgm } });
  t.after(() => db.close());
  await db.exec('CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user"(id uuid PRIMARY KEY,email text);');
  for (const file of ["0001_init.sql", "0003_knowledge_processing.sql", "0005_shared_departments.sql", "0006_rename_staff_to_team_leader.sql", "0008_knowledge_library.sql", "0010_document_display_text.sql"]) {
    await db.exec(source(`migrations/${file}`));
  }
  const sql = async (strings, ...values) => {
    const params = [];
    let text = strings[0];
    values.forEach((v, i) => {
      params.push(v);
      text += `$${params.length}` + strings[i + 1];
    });
    return (await db.query(text, params)).rows;
  };
  sql.unsafe = (u) => ({ unsafe: u });
  const dept = randomUUID();
  await db.query(`INSERT INTO departments(id,slug,name,is_shared) VALUES ($1,'hr','HR',false)`, [dept]);

  // Synthetic passages in two synthetic documents.
  const passages = {};
  for (const [key, title, text] of [
    ["a", "Synthetic doc A", "Synthetic passage A about badges."],
    ["b", "Synthetic doc B", "Synthetic passage B about parking."],
    ["c", "Synthetic doc C", "Synthetic passage C about training."],
  ]) {
    const docId = randomUUID();
    await db.query(
      `INSERT INTO knowledge_documents(id,department_id,title,file_name,file_type,file_size_bytes,checksum,status,chunk_count,extracted_text)
       VALUES ($1,$2,$3,'s.txt','txt',1,$4,'active',1,$5)`,
      [docId, dept, title, randomUUID(), text],
    );
    const chunkId = randomUUID();
    await db.query(
      `INSERT INTO knowledge_chunks(id,document_id,department_id,chunk_index,content,heading,page_number,embedding)
       VALUES ($1,$2,$3,0,$4,'Synthetic heading',3,$5::vector)`,
      [chunkId, docId, dept, text, JSON.stringify(vec)],
    );
    passages[key] = { chunk_id: chunkId, document_id: docId, document_title: title, department_name: "HR", department_id: dept, heading: "Synthetic heading", page_number: 3, content: text, score: 0.9 };
  }

  const retrievals = [[passages.a, passages.b], [passages.c]];
  let call = 0;
  const chat = load("src/lib/services/chat-knowledge.server.ts", {
    "@/lib/db/client.server": { sql },
    "./retrieval.service": {
      retrieveForUser: async () => ({ chunks: retrievals[call++], scope: "department" }),
    },
    "@/lib/knowledge/conflict-notice.server": {
      openConflicts: async () => [],
      conflictInstruction: () => "",
      CONFLICT_CHECK_FAILED_INSTRUCTION: "",
    },
  });
  const { citationSources } = chat;

  // Answer 1 cites [2] (passage b) and [1] (passage a).
  const ctx1 = await chat.buildKnowledgeContext({ question: "q1", departmentId: dept, globalSearch: false });
  const sources1 = citationSources(ctx1.chunks);
  await chat.recordExchange({ sessionId: null, question: "q1", answer: "Parking [2], badges [1].", context: ctx1, globalSearch: false, responseMs: 1 });
  const sessionId = (await db.query(`SELECT session_id FROM chat_messages ORDER BY created_at LIMIT 1`)).rows[0].session_id;

  // Answer 2 in the same session, different passages, cites [1] (passage c).
  const ctx2 = await chat.buildKnowledgeContext({ question: "q2", departmentId: dept, globalSearch: false });
  const sources2 = citationSources(ctx2.chunks);
  await chat.recordExchange({ sessionId, question: "q2", answer: "Training [1].", context: ctx2, globalSearch: false, responseMs: 1 });

  const assistants = (await db.query(`SELECT id FROM chat_messages WHERE role='assistant' ORDER BY created_at`)).rows;
  assert.equal(assistants.length, 2);
  const stored = async (messageId) =>
    (await db.query(
      `SELECT mc.rank, mc.chunk_id, c.content FROM message_citations mc JOIN knowledge_chunks c ON c.id = mc.chunk_id
        WHERE mc.message_id=$1 ORDER BY mc.rank`,
      [messageId],
    )).rows;

  const first = await stored(assistants[0].id);
  assert.deepEqual(first.map((r) => r.rank), [1, 2]);
  for (const row of first) {
    const shown = sources1.find((s) => s.n === row.rank);
    assert.equal(shown.chunkId, row.chunk_id, `rank ${row.rank} of answer 1 is the passage the browser was shown`);
  }
  assert.equal(first[1].chunk_id, passages.b.chunk_id, "[2] in answer 1 is passage B");

  const second = await stored(assistants[1].id);
  assert.deepEqual(second.map((r) => r.rank), [1]);
  assert.equal(second[0].chunk_id, passages.c.chunk_id, "answer 2 never carries answer 1's sources");
  assert.equal(sources2[0].chunkId, second[0].chunk_id);
});
