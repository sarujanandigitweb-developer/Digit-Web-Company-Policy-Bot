-- 0011_drive_library_cache.sql — cache for the Google Drive Document Library.
--
-- Apply with the DIRECT host:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f migrations/0011_drive_library_cache.sql
--
-- This is NOT part of the Admin Knowledge system. It shares no foreign key, no
-- join, no code path with knowledge_documents / knowledge_chunks /
-- knowledge_folders. It exists solely so the user-facing Document Library does
-- not re-download and re-parse the same Drive file on every question.
--
-- One row per Drive file. The row IS the cache — there is no separate
-- "processing" state, because there is nothing to embed: Method A puts the
-- whole extracted text into the prompt (see google-drive.server.ts), so there
-- is no chunk table, no embedding column, and no vector index here.
--
-- Additive and idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS drive_document_cache (
  drive_file_id   text PRIMARY KEY,
  -- Drive's own modifiedTime, when a service account is configured and can
  -- read it. NULL means the deployment has no service account yet, and
  -- invalidation falls back to fetched_at + a fixed TTL (see the server code) —
  -- a deliberately temporary, honestly-weaker cache key than modifiedTime.
  modified_time   timestamptz,
  mime_type       text NOT NULL,
  name            text NOT NULL,
  -- Text only. No inline images are kept here: unlike the admin viewer, this
  -- cache exists to feed the LLM prompt, not to render a rich reading view, so
  -- there is no display_text/extracted_text split to maintain.
  extracted_text  text NOT NULL,
  -- Reading copy with inline images kept (same split as the Admin Knowledge
  -- Library's display_text/extracted_text, migration 0010) — Word documents
  -- can carry base64 screenshots that would otherwise blow the AI's context
  -- budget for no benefit, since the model cannot see an image anyway.
  -- NULL means it is identical to extracted_text (no images were stripped).
  display_text    text,
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE drive_document_cache IS
  'Isolated cache for the user-facing Google Drive Document Library. '
  'Not read or written by any Admin Knowledge code path.';

COMMIT;
