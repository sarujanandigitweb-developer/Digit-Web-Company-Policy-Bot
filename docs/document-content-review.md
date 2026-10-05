# Document content comparison and approval

Development branch: `feature/document-conflict-review`
Base branch: `feature/admin-access-modify`, commit `536c8d0`.

## What changed

The PostgreSQL admin upload pipeline now processes text and embeddings into `pending_review`, starts one resumable comparison, and requires explicit publication before any uploaded passage can reach chatbot retrieval. The original extracted/display text remains stored. Replacement uploads preserve the approved prior version until publication succeeds.

Open **Admin → Knowledge → document details → Content comparison and approval**. Continue the comparison, review each overlapping passage, and publish only after all decisions are recorded. The Knowledge list has a Pending review filter and count. Processing retries are restricted to failed ingestion; direct Activate cannot bypass review.

For existing documents, choose **Scan existing document** on the same details page. An existing scan keeps compatible knowledge available and quarantines both sides of flagged conflicting/uncertain/partially overlapping passages until reviewed publication. This is an explicit scan, not an automatic alteration of existing company policy. Review existing sources before uploading additional information. After publishing a correction, other open reviews may become stale and must be restarted.

## Reviewer decisions

| Decision           | Published effect                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep existing      | Excludes the entire incoming passage; preserves a retained canonical source.                                                                             |
| Use incoming       | Includes this passage and excludes every listed overlapping source passage in full. An admin is required to replace shared or other-department guidance. |
| Exact excerpt      | Includes only a continuous, verbatim excerpt selected from the source. Existing passages remain unchanged. Useful for mixed repeated/new content.        |
| Different contexts | Keeps both after the reviewer confirms different applicability. Not allowed for equivalent duplicate content.                                            |

All overlaps require a written reason and the policy owner's confirmation. AI proposes relationships; it does not choose the correct company rule. Corrected text must come from an approved source. This feature does not rewrite source PDFs or Google Drive documents. **Correction:** the uploaded file itself is not stored. The pipeline keeps extracted text, display text, checksum and metadata, and `storage_key` is unused. "Preserved" in this document means the extracted text is kept, not the original bytes. Keeping original files needs object storage, which is not part of this branch. A duplicate-only upload remains inactive after publication.

## Library conflict scan and chatbot disclosure

Migration `0013_conflict_scan.sql` adds `knowledge_conflict_scans` and `knowledge_pair_comparisons`. It is additive and idempotent, and it changes no existing table.

- **Scan (Admin → Knowledge → Library conflict scan, admins and super admins only).** Each step compares one active, searchable passage with its candidates in the same or shared departments, using the existing classifier. Each pair is stored once, from either side, so findings are deduplicated and an interrupted scan resumes. Steps are compare-and-set on the cursor, so a double-click or a second administrator gets a 409 rather than a duplicate. The scan is read-only: it changes no chunk, document status or retrieval result. A failed classification is stored as **uncertain** for human review and never as new information. Findings are grouped into conflicts, uncertain, partly repeated and duplicates, each with both sources side by side. A finding disappears once either passage is no longer active and searchable.
- **Disclosure (chatbot).** When an open conflict is relevant to the question and both of its documents fall inside the request's department scope, the answer prompt states that approved sources disagree, names the two documents by title only, and forbids choosing either version. Open conflicts come from library-scan findings and from per-document reviews still in progress. Titles are the only thing that leaves the module. If the conflict check itself fails, the prompt gets a cautious instruction rather than none. With no open conflict the prompt is unchanged.
- **Not done here.** The scan does not resolve anything. Each conflict is resolved through its document's existing review, which is the only path that changes what is published. Resolving a library-scan finding directly from the scan screen is future work.

Known limits: the classifier is a model, so the scan finds candidates and proposes relations, it does not prove completeness. Candidate search takes the eight closest vectors and eight lexical matches per passage. Passages within one document are not compared with each other. Different departments are compared only when one of them is shared, and a difference in date or applicability is only as reliable as the model's reading of it.

An exact excerpt is re-embedded. Other comparisons reuse stored embeddings. Source and page/heading references are shown side by side. Audit entries record scans, decisions, excerpts, notes, reviewer identities and published exclusions.

## Scope and limitations

This gate covers `knowledge_documents`/`knowledge_chunks`, the default database chatbot, resource-scoped retrieval and the PostgreSQL resource reading service. It does not merge the independent Google Sheets/Drive Document Library or its full-document question path into this pipeline. That path, and explicit `KNOWLEDGE_SOURCE=transcript` mode, remain independent and do not inherit these approvals. Verify the test application's active knowledge source before claiming that every answer is governed by the new gate.

Candidates are the union of the closest eight stored vectors and eight lexical matches, plus eligible earlier passages from the same document within those rankings. Department documents compare against their department plus shared knowledge. Shared documents compare against every department they affect. This is a bounded, model-assisted search, not a proof that every possible semantic conflict was found. Broad existing-source scans and policy-owner review remain necessary. Chunk boundaries can mix rules: prefer an exact new excerpt, or an approved source edit and re-upload, over superseding a passage that also contains unrelated rules.

A missing/timed-out provider or incomplete model response produces **uncertain**, not approval. No candidate matches produces new information subject to final publication approval. Comparisons have a bounded provider time budget and resume one passage per request; pausing or closing the screen preserves completed comparisons and decisions.

Publication checks a fingerprint of the applicable live knowledge and the source's retained passages. Knowledge writes serialize through a transaction advisory lock. Source changes invalidate old decisions rather than allowing stale publication. A fully superseded existing scan can be restarted to clear stale quarantine without restoring retired text.

## Database and local validation

Apply `migrations/0012_document_review.sql` to the intended **test database before running this branch**. It adds the pending-review enum, review metadata, searchable-content controls, persisted review rows, filtered search view and snapshot function. The enum addition must commit before later statements use it; do not wrap the entire file in a transaction.

Example with the already-configured test connection:

```bash
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f migrations/0012_document_review.sql
npm ci
npm test
npx tsc --noEmit
npm run build
```

The migration is repeatable. Existing rows default to retained content and remain available until scanned. New chunks are explicitly inserted with searchable access disabled. Rollout requires the migration and application changes together. Do not revert to the old ingestion code while expecting the review gate to remain enforced.

## Automated evidence

- Real PostgreSQL/pgvector tests run in isolated PGlite instances with the existing schema migrations and migration 0012. No live database or credentials are used.
- Classification and embedding fixtures are deterministic; these tests validate SQL, scope, approval state and publication behavior, not live model accuracy.
- Tests cover migration repeatability; new upload processing; unresolved publication/activation blocking; duplicate exclusion; corrected guidance; exact excerpts; preserving original text; both-side quarantine for existing scans; shared-source permissions; missing/incomplete provider results; stale reviews; preventing superseded-source resurrection; replacement publication; resource reading and document-scoped retrieval.
- Server-rendered interface tests verify side-by-side passages, source/page references, blocked publication and new-content approval controls. These are not an authenticated browser end-to-end test.
- Existing permission, retention and Drive cache tests run alongside the new tests. The Drive cache test was corrected to assert the existing 60-second modified-time memo before and after expiry; its application code was not changed.

## Remaining review and release checks

No production changes, actual policy corrections, live migration, authenticated browser test, live LLM Q&A or Vercel Preview verification were performed in this environment. Before release, the developer must test migration 0012 with the application's actual test database and configured model, then verify upload → comparison → decision → publication → answer.

Use management-approved questions for new, duplicate, conflicting and mixed-content documents. Check existing company questions and a question with no supported answer. Confirm that pending/excluded content cannot appear in general or document-scoped answers, and verify source/page references. Test a team leader attempting to replace shared guidance and concurrent reviewers changing the knowledge base.

PASS: unresolved/uncertain content is unavailable, equivalent content is indexed once, selected new content is retained, superseded content is excluded, required audit records exist, existing approved answers still work, and unsupported questions do not invent rules. Technical/senior review is required before merge; management/HR must decide which conflicting company policy is authoritative. A live model's scan is a review aid, never automatic business approval.

## Conflict scan validation — 2026-10-05

- `npm test`: **44 passed, 0 failed** (the branch's 32, plus 8 scan and disclosure tests in `tests/conflict-scan.test.mjs` and 4 interface tests in `tests/conflict-scan-ui.test.mjs`).
- Scan and disclosure tests use real PostgreSQL SQL (PGlite with pgvector and pg_trgm) and deterministic **synthetic** rules in place of the model. They verify SQL, scope, deduplication, read-only behaviour, stale-cursor refusal and failure handling. They do not verify model accuracy.
- Migration 0013 applied twice on top of 0012: no error, tables present.
- Unauthenticated `GET` and `POST` to `/api/admin/knowledge/conflict-scan` return 401 against the running dev server.
- Not verified: the scan on the real library, the model's classifications, an authenticated browser session, and the live database.

## Validation result — 2026-10-05

- Full regression suite: **32 passed, 0 failed**.
- Final recheck after source-context/fingerprint changes: **20 review/database/interface tests passed, 0 failed**.
- TypeScript: **PASS** (`npx tsc --noEmit`).
- ESLint on changed implementation files: **PASS**.
- Vercel-target production build: **PASS** (`npm run build`).
- Whitespace check: **PASS** (`git diff --check`).
- Actual policy data, live model semantic accuracy, multi-connection lock contention, authenticated browser flow, test-database migration and Vercel Preview: **NOT VERIFIED**.

## Follow-up: read-only existing scans, resolution, and live evidence

**Read-only existing scans.** Starting, resuming or completing a scan of an existing approved document changes no status and no searchable content. Migration `0014_read_only_existing_scan.sql` removes the per-scan quarantine from `knowledge_search_chunks`. A flagged passage stays answerable and the chatbot discloses the disagreement instead. Visibility changes only when a reviewer's decision is published. Unpublished uploads remain protected because their passages are not searchable (`is_searchable = false`) until publication.

**Decisions.** `unresolved` (new) withholds the incoming passage, leaves the existing source untouched, and keeps the conflict open. The chatbot discloses it. The reviewer UI offers it for every flagged passage, and it requires a written reason.

**Replacements.** A replaced version is archived only when publication has removed every passage it still contributes. Otherwise only the affected passages are withheld, and unaffected content stays live. A document that a decision leaves with no searchable passage becomes `inactive`, and the audit record lists it in `emptied_document_ids`.

**Resolving a library-scan finding.** Each finding links to the review of the document that owns the passage (`/admin/knowledge/:id#content-review`). A reviewer starts the document's review, compares it, and records a decision. This works for active documents, which the scan tests and the live check exercise.

**Who may decide.** Taken from `src/lib/auth/permissions.ts` and the review routes:

| Role | Can scan library | Can compare, decide and publish a document | Can replace shared or other-department guidance |
|---|---|---|---|
| team_leader | no | yes, for their own department only (`requireAdminArea`, scope checked in `documentForReview`) | no (`Forbidden`, enforced in `decide` and `publish`) |
| admin | yes | yes, all departments | yes |
| super_admin | yes | yes, all departments | yes |

Unauthenticated requests are refused with 401. Whether team leaders should approve company knowledge at all is a business decision. This branch does not change it.

**Live evidence** (`tests/live/chatbot-live.mjs`, run separately from `npm test`). Real embeddings, real classifier, real model responses, an isolated PGlite database, synthetic documents only. Results from one run:

- Supported question ("leave days per month"): answered `2`, cited.
- Known conflict (meeting-room booking window, 7 vs 14 days): answered that approved sources disagree, named both documents, gave neither value as the rule.
- Unsupported question ("dinosaur parking"): fixed "Sorry" response, no invented policy.
- Pending upload claiming 30 days: not searchable; its value and title never appeared in answers.
- After a published `keep_existing` decision on the 14-day memo: answered `7 days`, no conflict notice.

Observed limitation: similarity between a question and an unrelated passage in this small synthetic corpus is about 0.55–0.58, above the 0.5 disclosure floor. A conflict notice can therefore appear for unrelated questions. In the run the answers were still correct and did not mention the conflict. Over-disclosure is accepted because the opposite error would let the chatbot choose a side silently. The floor is configurable through `KNOWLEDGE_CONFIDENCE_FLOOR`.

Observed inconsistency: the library scan classified the guide–memo pair as a conflict, but the per-document review of the memo classified the same passage as uncertain. Both use the same model but independent candidate sets and non-deterministic model output. A reviewer should treat findings from either as a prompt to decide, not as a verdict.
