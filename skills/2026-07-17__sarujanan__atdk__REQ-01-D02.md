---
date: 2026-07-17
developer: Sarujanan
project: Ask the Digit – Knowledge Interface
project_code: ATDK
phase: Development - phase 02
requirement_id: REQ-01
deliverable_id: D02
status: In Progress
evidence_location: /skills/evidence/ATDK/REQ-01-D02/  (NOT YET CREATED — see GAP-06)
blos_keys_used:
  - (none — project has no BLOS table; see GAP-01)
hardcoded_thresholds:
  - retrieval_vector_weight = 0.75          # src/lib/services/retrieval.service.ts:44
  - retrieval_candidate_pool = 40           # src/lib/services/retrieval.service.ts:46
  - retrieval_default_limit = 8             # src/lib/services/retrieval.service.ts:43
  - gap_dedup_similarity = 0.6              # src/lib/services/chat-knowledge.server.ts:217 (inline SQL)
  - queue_stale_window = 5 minutes          # 3 separate files — see GAP-02
  - transcript_cache_ttl = 5 minutes        # src/lib/transcript.server.ts:4
  - provider_max_retries = 0                # src/lib/ai/gateway.server.ts:26
  - confidence_band_high = 0.55             # src/components/admin/confidence.ts:11
  - confidence_band_medium = 0.45           # src/components/admin/confidence.ts:16
  - env-overridable (not BLOS-governed, but visible):
    - KNOWLEDGE_CONFIDENCE_FLOOR = 0.5      # src/lib/services/chat-knowledge.server.ts:27
    - KNOWLEDGE_CHUNK_SIZE = 1200           # src/lib/knowledge/chunk.ts:20
    - KNOWLEDGE_CHUNK_OVERLAP = 200         # src/lib/knowledge/chunk.ts:21
    - KNOWLEDGE_CHUNK_LIMIT = 8             # src/lib/services/chat-knowledge.server.ts:29
    - EMBEDDING_BATCH_SIZE = 32             # src/lib/knowledge/embed.server.ts:21
    - EMBEDDING_MAX_ATTEMPTS = 3            # src/lib/knowledge/embed.server.ts:22
    - AI_FIRST_CHUNK_TIMEOUT_MS = 20000     # src/lib/ai/gateway.server.ts:36
    - MAX_FILE_BYTES = 20971520             # src/lib/knowledge/parse.server.ts:33 (no env override)
three_am_standard: TRUE
llm_queryable: TRUE
company_knowledge_candidate: TRUE
domain: Knowledge Management / Internal AI Operations
User: (not recorded — see GAP-07)
benefit_status: Pass — chatbot now answers from the managed knowledge base; verified against a
  question that previously returned "not in the document" (see Section 2, evidence E1)
---

# REQ-01-D02 — Connect the chatbot to the managed knowledge base (retrieval pipeline)

---

## 1. SYSTEM STATE

State before this deliverable began:

- **The chatbot answered from a single hard-coded Google Drive document.** `/api/chat` called
  `fetchTranscript()`, which downloaded one file (`drive.google.com/uc?export=download&id=1T-0ve…`)
  and inlined the **entire text into the system prompt on every request**.
- **No retrieval existed.** No chunking, no embeddings, no vector store. The approach could not
  scale past one document: every turn paid the full manual in input tokens, and corpus size was
  bounded by the model's context window.
- **The admin console could upload documents, but the chatbot could not see them.** Documents,
  chunks and embeddings were being written to Postgres correctly and were completely unused by
  the answer path.
- **Citations were scraped from the model's own prose.** `extractSources()` regexed a `## Sources`
  section out of the answer text. Observed failure: the model quoted its **own system-prompt
  instruction** back as if it were company policy (see Section 6, FM-01).
- Database: Neon Postgres 18.4, `ap-southeast-1`. pgvector 0.8.1 and pg_trgm 1.6 available.
  Migrations 0001–0003 applied. Auth (Neon Auth / Better Auth), users, departments, knowledge
  ingestion and admin APIs already delivered under earlier deliverables.

---

## 2. WHAT CHANGED TODAY

**Replaced the answer source: Drive document → database retrieval.**

The logic now runs as follows on each `POST /api/chat`:

1. The user's latest message is extracted as the retrieval query (`latestQuestion()`).
2. The requested department (a slug, or `"all"`) is resolved to a department id via
   `resolveDepartment()`. An **unknown slug resolves to `null` rather than erroring** — a stale
   picker value widens the search instead of breaking the chat.
3. `retrieveForUser()` runs hybrid retrieval (Section 5, VR-02) and returns up to 8 chunks plus a
   `scope` of `department` or `global`.
4. `buildKnowledgeContext()` renders those chunks into the system prompt as numbered excerpts
   (`[1] <title> — <heading>, page N (<department>)`) and instructs the model to cite inline as
   `[1]`, `[2]`.
5. `streamChatWithFallback()` streams the answer through the existing provider chain — **unchanged**.
6. The response stream is **teed**: one copy goes to the browser untouched, the other is read to
   reassemble the finished answer text. Without the tee the whole reply would have to be buffered
   before sending, which would destroy streaming.
7. `recordExchange()` persists the session, both messages, the real citations, and — when
   confidence is below the floor — a knowledge gap.

**Prompt change:** the model is no longer asked to write its own `## Sources` section. Citations
are recorded from what retrieval actually returned, so the model **cannot fabricate one**.

**Rollback:** `KNOWLEDGE_SOURCE=transcript` restores the previous Drive behaviour without a deploy.
The old path is preserved verbatim in `legacyTranscriptAnswer()`.

**Department picker** added to the chat header (replacing a static "Knowledge Base Connected"
pill). It is populated by a new **public** endpoint `GET /api/departments`, which returns only
departments that are `active` **and** have at least one `active` document — offering a department
with no content only produces a shrug.

**Evidence E1 — the behaviour change, same question before and after:**

| | |
|---|---|
| Before | *"The provided policy document does not contain any information regarding 'bgct.'"* |
| After | *"BGCT stands for **Best Guidance Criteria Tutorial** [2][3]. It is a comprehensive operational framework that governs US marketplace operations across Amazon, eBay, Wayfair, and Walmart [1][3]…"* |

Server log: `[api/chat] scope=global chunks=8 confidence=0.559`

Root cause of the "before" state: `"bgct"` appeared in **18 uploaded chunks** and **0 times** in
the Drive document. The bot answered correctly — it was reading the wrong source.

---

## 3. POSTGRESQL / MCP FINDING

**F-01 — pgvector cannot index above 2000 dimensions. This constrains the embedding model choice.**

Tested directly against the live database (in a transaction, rolled back):

```
CREATE INDEX ON t USING hnsw (e vector_cosine_ops);
  vector(3072)   → ERROR: column cannot have more than 2000 dimensions for hnsw index
  vector(1536)   → OK
  halfvec(3072)  → OK
```

`gemini-embedding-001` returns **3072 dimensions by default**. A naive `vector(3072)` column would
have been **unindexable** — every department search would degrade to a sequential scan over every
chunk. Resolution: request `outputDimensionality: 1536` (Matryoshka truncation, a supported model
output, not a lossy hack) and store `vector(1536)`.

**F-02 — `text-embedding-004` is retired for new API keys** (404: *"not found for API version
v1beta"*). Only `gemini-embedding-001` is reachable. Same retirement pattern previously observed
on `gemini-2.5-flash`, which **still appears in the `models` list endpoint but 404s on
`generateContent`** — the list endpoint is not a reliable availability check.

**F-03 — `generate_series` aliasing.** An unaliased `generate_series(...) AS day` collides with a
subquery column named `day`, producing `ERROR: column reference "day" is ambiguous` at runtime.
TypeScript cannot see inside SQL template strings; this only surfaced by executing it. Fix:
`generate_series(...) AS s(day)` and join on `s.day`.

**F-04 — Cosine distance is the correct operator here.** Gemini embeddings truncated below 3072
are **not re-normalised**. Cosine (`<=>`) is scale-invariant so it stays correct; inner product
would not.

**F-05 — Backticks inside a SQL comment terminate a JS template literal.** A comment reading
``-- `to` is inclusive`` broke the file at parse time. SQL comments inside tagged templates must
avoid backticks.

**F-06 — Two-connection visibility.** `sql` (Neon HTTP driver) and `withTransaction` (pooled TCP)
are **different connections**. A read issued through `sql` **cannot see** an uncommitted
transaction. See Section 6, FM-02.

**F-07 — Deletion semantics are already correct and are load-bearing.** `profiles.user_id →
neon_auth."user"` is `ON DELETE CASCADE`, while every historical reference
(`chat_sessions.user_id`, `knowledge_documents.uploaded_by`, `audit_logs.actor_id`,
`knowledge_gaps.*`) is `ON DELETE SET NULL`. Deleting a person therefore **preserves the audit
trail and anonymises it**, rather than destroying the record of what happened.

---

## 4. GAP FOUND

**GAP-01 — No BLOS table exists in this project. This is the primary governance gap.**
Every operational threshold listed in `hardcoded_thresholds` lives in either an environment
variable (visible, but not governed or reviewable) or a module constant (hidden in code). Per BLOS
governance, **scoring formulas, thresholds and retry limits must not silently live inside code**.
The highest-priority migrations to BLOS:
- `retrieval_vector_weight = 0.75` — a **scoring formula weight**, currently a bare constant.
- `gap_dedup_similarity = 0.6` — **inline in a SQL string**, the least visible form.
- `KNOWLEDGE_CONFIDENCE_FLOOR = 0.5` — decides what becomes a knowledge gap; will need re-tuning
  as the corpus grows (see D-02).

**GAP-02 — `queue_stale_window = 5 minutes` is duplicated across three files**
(`process.server.ts:148`, `system.status.ts:84`, `settings.ts:32`). Three copies of one business
rule **will** drift. Single BLOS key required.

**GAP-03 — Department selection is self-declared, not access control.** The chat has no login;
`chat_sessions.user_id` is always null. Anyone with the URL can select any department from the
dropdown. This is acceptable only if **all** departmental content is safe for anyone who reaches
the bot. No requirement defines whether Finance/HR content is sensitive. **No fallback behaviour
is defined and no decision is recorded.** Escalate to the requirement owner.

**GAP-04 — Department-first is not department-only, and this is undocumented in the requirement.**
If the selected department yields no chunks, retrieval **falls back to a global search** rather
than returning nothing. Deliberate (a staff member asking something their own department has no
answer for should get the company answer), but it means the picker is a **preference, not a
boundary**. No requirement states which is intended.

**GAP-05 — Embeddings have no provider fallback.** Groq and OpenRouter expose **no embedding
endpoint**. Unlike chat completion, ingestion is Gemini-only and stops entirely if Gemini is
unavailable. Retry exists; a second embedding provider does not.

**GAP-06 — Evidence is not durable.** The end-to-end test suites that verify this deliverable
(95 assertions across users/knowledge) currently live in a **temporary scratchpad directory** and
will be lost. They are not in the repository and not at the declared `evidence_location`.

**GAP-07 — Business requester (`User`) is not recorded** for REQ-01. No product owner is
identified for traceability.

**GAP-08 — Vercel Hobby cannot drain the processing queue.** Confirmed from Vercel docs: **Hobby
cron is limited to once per day**; more frequent expressions *fail at deploy time*. A document
whose processing outlives the function invocation therefore waits up to 24h or needs manual retry.
One document (`Ledsone_CS_Handbook_v1.6_Complete`) is **currently stuck** in this state with 0
chunks — the failure mode is live, not theoretical.

---

## 5. VALIDATION RULE ADDED OR CHANGED

**VR-01 — Knowledge gap detection**

```
confidence := similarity score of the single best retrieved chunk (0 when nothing retrieved)

IF confidence < KNOWLEDGE_CONFIDENCE_FLOOR (0.5)
THEN record a knowledge gap with status 'pending'
     AND IF an existing 'pending' gap in the same department has
            similarity(existing.question, new.question) > 0.6   -- pg_trgm
        THEN increment occurrence_count and update last_asked_at
        ELSE insert a new gap row
```

Rationale for dedup: the same missing policy gets asked repeatedly. Fifty identical rows are
noise; one row with `occurrence_count = 50` is a priority signal. **Verified:** "what is the
company pension **plan**" collapsed into "what is the company pension **scheme**" → `freq = 2`.

**VR-02 — Hybrid retrieval**

```
candidates := top 40 chunks by cosine distance
              WHERE document.status = 'active'
                AND chunk.embedding IS NOT NULL
                AND (department filter IS NULL OR chunk.department_id = filter)

score := 0.75 * (1 - cosine_distance) + 0.25 * trigram_similarity(content, query)

return top 8 by score
```

Rationale: **vector search alone reliably misses exact tokens** — "48 hours", a section number, a
form name — because those carry little semantic weight. Trigram alone misses paraphrases. Both
arms score every candidate.

**VR-03 — Only `active` documents are retrievable.** Enforced in SQL (`WHERE d.status = 'active'`),
not filtered afterwards, so a retired policy **cannot** answer a question. **Verified:** archiving
a document removed it from results; reactivating restored it.

**VR-04 — Activation requires embedded chunks (changed).** Previously checked the denormalised
`chunk_count` column. Now counts live rows `WHERE embedding IS NOT NULL`. A cached counter can
outlive the rows it counts; activating on it would publish a document retrieval can never return,
**hiding a failed ingestion behind a green "Active" badge**.

**VR-05 — Staff cannot widen their own scope.** In `/api/admin/knowledge/search`, a non-management
role's `departmentId` parameter is **ignored** and replaced with their own `profiles.department_id`.
**Verified:** staff passing another department's id still received only their own department's chunks.

---

## 6. FAILURE MODE OR EDGE CASE

**FM-01 — Prompt leakage into citations (fixed, root cause removed).** When the model was asked to
author its own `## Sources` section, it emitted its own instruction — *"Answer ONLY using
information found in the DOCUMENT… (Internal Rule)"* — formatted as a policy quotation. Any design
that asks an LLM to self-report its sources can fabricate them. Citations are now recorded from
retrieval output; the model is not asked for them.

**FM-02 — Read-after-write across two connections (fixed).** `create()`/`update()` in
`users.service.ts` ended with `return getById(...)` **inside** `withTransaction`. `getById` uses
the HTTP driver — a different connection — which cannot see the uncommitted transaction. The API
returned **404 for a user it had just created**. Reads must occur after `COMMIT`. This survives
code review indefinitely; only execution exposes it.

**FM-03 — A provider that hangs stalls the entire fallback chain.** Fallback triggers on *errors*.
A provider that accepts the connection and never streams produces no error, so the chain waits
forever — worse than a clean failure. Observed live with OpenRouter. Mitigated by
`AI_FIRST_CHUNK_TIMEOUT_MS = 20000`, which bounds **only the probe**; a committed slow generation
runs as long as it needs.

**FM-04 — Mid-stream failure cannot be recovered.** Fallback is only possible before the first
content chunk. Once tokens are on the wire, a mid-stream failure surfaces to the client. Inherent
to streaming, not a defect.

**FM-05 — Confidence floor set below the observed failure band silently disables gap detection.**
See D-02. A floor of 0.35 sat **beneath every unanswerable question**, so the review queue stayed
permanently empty while appearing to work.

**FM-06 — Documents with no extractable text.** Scanned/image-only PDFs parse to empty and are
rejected at upload (`"No readable text found in this file"`) rather than being ingested as an
empty document. **No OCR path exists.**

**FM-07 — Large uploads may never finish on Vercel.** Processing runs under `waitUntil`, bounded by
the function's execution limit. Combined with GAP-08 (no cron drain on Hobby), a large PDF can
stall indefinitely. Live example: `Ledsone_CS_Handbook_v1.6_Complete`, 0 chunks.

**FM-08 — Better Auth rejects credentialed cross-origin requests from untrusted origins.**
Reproduced exactly:

```
POST /sign-in/email  Origin: <vercel domain>  WITHOUT cookie → 200
POST /sign-in/email  Origin: <vercel domain>  WITH    cookie → 403 {"code":"INVALID_ORIGIN"}
POST /sign-in/email  Origin: http://localhost WITH    cookie → 200
```

**CSRF origin validation applies only to credentialed requests.** A curl test without cookies
passes and gives a false all-clear — the browser always sends cookies. `trusted_origins` is
currently `[]`; only localhost works (via `allow_localhost`). **Production login is blocked until
the domain is added.**

---

## 7. DECISIONS MADE TODAY

**D-01 — Store `vector(1536)` via Matryoshka truncation, not `halfvec(3072)`.**
Both are indexable and, at 6144 bytes/row, **identical in storage**. `vector(1536)` chosen because
truncation is a supported model output with better tooling support, whereas `halfvec` trades
precision across all dimensions. Reversible: changing dimension requires a migration plus re-embed.

**D-02 — Confidence floor raised 0.35 → 0.5, calibrated from observed traffic, not guessed.**
The initial 0.35 was an assumption. Measured against real questions:

| Class | Observed best-chunk score |
|---|---|
| Answerable | 0.518, 0.534, 0.554, 0.559, 0.571, 0.571 |
| **Unanswerable** | **0.397, 0.444, 0.448** |

Clean separation with a midpoint near 0.50. At 0.35, **zero gaps were ever recorded** — the
feature was silently inert. After the change, gaps record correctly. **Must be re-tuned as the
corpus grows**; this is a snapshot calibration on a small corpus, not a permanent constant.

**D-03 — Keep the legacy Drive path behind `KNOWLEDGE_SOURCE=transcript`.**
Retrieval quality is a judgement call that can regress. A flag makes rollback one env var, not a
deploy.

**D-04 — Do not store the assembled prompt or the query embedding.**
The prompt is deterministic from the recorded citations and can be reconstructed; the query
embedding is 1536 floats per message and deterministic from the question. The admin Debug panel
therefore shows a **reconstructed** prompt, **labelled as such** rather than presented as a
captured artefact.

**D-05 — Bulk actions loop existing single-document endpoints.**
No new bulk API. The admin gets one gesture; the server sees calls it already validates and audits
individually. Partial failures are reported honestly ("3 archived, 1 failed").

**D-06 — Persist extracted text; do not store the original file.**
`storage_key` is null on every document. The pipeline needs text, not the file. Consequence:
**Download/Preview-the-file are impossible**, and retry re-chunks from stored text without
requiring a re-upload. Revisit if file download becomes a requirement (would need Vercel Blob).

---

## 8. COMPANY KNOWLEDGE EXTRACT

Reusable intelligence for **any** future RAG or LLM system in this company:

**K-01 — Verify model and index constraints before designing the schema.**
Two constraints nearly shipped as defects: pgvector's 2000-dim index cap, and Gemini's default
3072-dim output. The intersection is invisible in either product's documentation alone. **Test the
index creation against the real database before committing to a vector column width.**

**K-02 — A provider's model-list endpoint is not an availability check.**
`gemini-2.5-flash` was listed and 404'd on use. Model retirement is **per-account**: a working
integration breaks the moment a key is rotated to a newer account. Probe `generateContent`, not
`models`.

**K-03 — Confidence thresholds must be calibrated from observed traffic, never assumed.**
A threshold set below the real failure band disables the feature **silently** — it looks healthy
and captures nothing. Always measure the answerable and unanswerable distributions before setting
a cutoff, and treat the value as a BLOS key requiring periodic re-tuning.

**K-04 — Never let an LLM self-report its sources.**
It will fabricate them, including quoting its own instructions as if they were company policy.
Record citations from the retrieval layer. This applies to every grounded-answer system.

**K-05 — Hybrid retrieval is required where exact tokens carry meaning.**
Operational corpora are full of "48 hours", "12%", "LKR 50000", section numbers. Vector search
weights these poorly. Blend vector with keyword (pg_trgm) search. Starting point: **0.75 vector /
0.25 keyword** — a BLOS candidate, not a constant.

**K-06 — Serverless has no background worker; design the queue as a table.**
The row **is** the queue. Process opportunistically after responding, and provide an idempotent
drain for anything a killed invocation left behind. Verify the platform's cron limits **before**
depending on them — Vercel Hobby is once per day, which cannot drain a queue.

**K-07 — Streaming SDKs may not throw. Errors can arrive as data.**
Vercel AI SDK `streamText` never throws; a failed request surfaces as an `error` chunk *inside*
the stream, and `{type:"start"}` is emitted **before** the provider request resolves. Any fallback
design must therefore buffer the preamble and commit only on real content. **A hang produces no
error at all** — always bound the probe with a timeout.

**K-08 — Two database drivers means two connections means two visibility scopes.**
HTTP drivers and pooled TCP clients cannot see each other's uncommitted work. Read after commit.
This class of bug is invisible to type checking and to code review.

**K-09 — CSRF checks may apply only to credentialed requests.**
A curl test without cookies passes; the browser fails. **Reproduce auth issues the way the browser
issues them** — with credentials — or the test gives a false all-clear.

**K-10 — Prefer live counts over denormalised counters for safety gates.**
A cached count can outlive the rows it counts. Any gate that decides "is this publishable" should
count reality.

**K-11 — Delete should cascade identity and null history.**
`ON DELETE CASCADE` for credentials, `ON DELETE SET NULL` for audit/history. The record of what
happened must survive the deletion of who did it.

**K-12 — Config-driven scoping supports future expansion.**
Departments are user-created and unbounded; deriving presentation (e.g. colour) from a hash of the
name avoids a schema change per department. Same principle as marketplace expansion: never enumerate
what the business will add to.

---

## 9. LLM STANDARD CHECK

| Check | Result |
|---|---|
| Terminology consistent with project vocabulary (chunk, embedding, confidence floor, knowledge gap, department scope, provider chain) | TRUE |
| Business rules stated as explicit logic, not prose summary | TRUE (Section 5, VR-01…VR-05) |
| Assumptions documented | TRUE (Section 7, D-01…D-06) |
| Edge cases documented | TRUE (Section 6, FM-01…FM-08) |
| Evidence referenced | **PARTIAL** — measurements and code paths cited inline with file:line; **durable evidence folder not yet created (GAP-06)** |
| Another developer can continue independently | TRUE — file:line references, rollback flag, and reproduction commands included |
| LLM-queryable structure | TRUE — stable metadata block, stable section headings, ID-tagged findings (F-, GAP-, VR-, FM-, D-, K-) for cross-file referencing |
| 3AM Standard | TRUE — failure modes carry reproduction steps and root cause, not just symptoms |

**Known weaknesses of this file, stated plainly:**
- `evidence_location` points at a folder that **does not exist yet** (GAP-06). Until the test
  suites and query outputs are committed there, this file's measurements are not independently
  re-verifiable.
- `phase` was **inferred** as "Development - phase 02"; it was not supplied with the requirement.
- `User` (business requester) is **unknown** (GAP-07).
- `blos_keys_used` is empty because **no BLOS table exists for this project** (GAP-01). This file
  should be treated as a BLOS onboarding candidate, not as a compliant one.

---

## ESCALATION FLAGS

1. **BLOS violation (GAP-01, GAP-02).** A scoring formula weight (`0.75`), a dedup threshold inline
   in SQL (`0.6`), and a queue window duplicated across three files are business logic hidden in
   implementation. Requires BLOS onboarding before this deliverable can be marked Validated.

2. **Undefined business rule (GAP-03).** Whether departmental knowledge is sensitive, and whether
   an anonymous user may select any department, is **not defined by any requirement**. The system
   currently permits it. Requires a decision from the requirement owner.

3. **Production blocker (FM-08).** `trusted_origins = []`. Admin login **will fail** on the Vercel
   domain until the production origin is registered in the Neon Auth configuration.

4. **Credential exposure — ACTION REQUIRED.** During this work the database password and the
   Gemini, Groq and OpenRouter API keys were pasted into a chat transcript. **No credential appears
   in this file or in any tracked repository file** (`.env` is gitignored; verified by scanning
   tracked files for each key). **All four credentials must be rotated before production use.**
