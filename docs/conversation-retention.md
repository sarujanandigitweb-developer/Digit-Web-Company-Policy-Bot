# Conversation retention handoff

The interrupted work had only added nullable system actors to the audit entry type.
The completed implementation adds:

- `conversations.service.ts`: seven-day retention based on `started_at`, with a database-generated cutoff and a transactional system audit entry, including empty runs.
- `/api/cron/conversations`: GET endpoint authenticated with `CRON_SECRET`; rejects missing configuration and incorrect credentials before deleting anything.
- `vercel.json`: daily production schedule, `0 0 * * *` (UTC).
- Settings API and page: read-only retention period, age basis, schedule and secret presence. Secret presence does not prove deployment or successful execution.
- `tests/conversation-retention.test.mjs`: isolated tests for authentication, cutoff parameters, auditing and audit failure propagation. Run with `node --test tests/conversation-retention.test.mjs`.

## Activation still required

1. Generate a fresh random `CRON_SECRET` and set it in Vercel Production. Do not reuse the secret printed in the pasted conversation.
2. Deploy these changes. Local development does not execute the production schedule.
3. The first scheduled invocation performs the initial cleanup too. For an immediate cleanup, invoke the deployed endpoint with `Authorization: Bearer <CRON_SECRET>` through a secure client.
4. Check the response and the `audit_logs` entry with `record_id = 'conversation-retention'` to verify the run.

No production deployment or live deletion was performed during this code completion. The old counts in the pasted conversation were not revalidated.

Deleting sessions cascades to their messages, citations and feedback. Existing foreign keys keep knowledge gaps and provider logs, clearing their deleted session/message references. The rule uses session creation time, so recent messages in an older session are deleted with that session. Daily execution means eligible records remain until the next successful run.

Vercel scheduling and authentication: https://vercel.com/docs/cron-jobs/manage-cron-jobs
