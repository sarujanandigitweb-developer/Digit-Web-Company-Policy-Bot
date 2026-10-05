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

All overlaps require a written reason and the policy owner's confirmation. AI proposes relationships; it does not choose the correct company rule. Corrected text must come from an approved source. The original upload is preserved; this feature does not rewrite source PDFs or Google Drive documents. A duplicate-only upload remains inactive after publication.

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

## Validation result — 2026-10-05

- Full regression suite: **32 passed, 0 failed**.
- Final recheck after source-context/fingerprint changes: **20 review/database/interface tests passed, 0 failed**.
- TypeScript: **PASS** (`npx tsc --noEmit`).
- ESLint on changed implementation files: **PASS**.
- Vercel-target production build: **PASS** (`npm run build`).
- Whitespace check: **PASS** (`git diff --check`).
- Actual policy data, live model semantic accuracy, multi-connection lock contention, authenticated browser flow, test-database migration and Vercel Preview: **NOT VERIFIED**.
