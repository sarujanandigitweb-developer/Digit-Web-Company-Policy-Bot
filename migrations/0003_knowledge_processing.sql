-- 0003_knowledge_processing.sql — additive changes for the ingestion pipeline.
--
-- Apply with the DIRECT host:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f migrations/0003_knowledge_processing.sql
--
-- Deliberately NOT wrapped in a transaction: ALTER TYPE ... ADD VALUE cannot be
-- used by later statements in the same transaction. Every statement is
-- IF NOT EXISTS / idempotent, so a partial run can simply be re-run.
-- Nothing here alters auth, users, audit or departments.

-- 'draft' completes the lifecycle: a document exists before processing starts.
-- Ordered before 'processing' so the enum reads in lifecycle order.
ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'processing';

-- Page provenance for citations. NULL for formats without pages (txt, md).
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS page_number int;

-- Chunking and embedding are separate stages, so a chunk exists before its
-- vector does. This is also what makes "chunk count" and "embedding count"
-- distinct dashboard numbers rather than the same number twice.
ALTER TABLE knowledge_chunks ALTER COLUMN embedding DROP NOT NULL;

-- Finds chunks still awaiting a vector, without scanning embedded ones.
CREATE INDEX IF NOT EXISTS knowledge_chunks_pending_idx
  ON knowledge_chunks (document_id) WHERE embedding IS NULL;

-- Object storage is optional: the pipeline needs extracted text, not the original
-- file, so uploads must not require a blob store to be configured.
ALTER TABLE knowledge_documents ALTER COLUMN storage_key DROP NOT NULL;

-- Retry re-chunks from this instead of demanding the file be uploaded again.
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS extracted_text text;

-- Processing statistics.
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS processing_completed_at timestamptz;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS processing_attempts int NOT NULL DEFAULT 0;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS page_count int;

-- The work queue: the document row is the queue. Partial index so claiming work
-- touches only rows that are actually waiting.
CREATE INDEX IF NOT EXISTS knowledge_documents_queue_idx
  ON knowledge_documents (created_at) WHERE status = 'processing';

-- A document is only unique per department while it is live; archived versions
-- keep their checksum so history is preserved. This enforces duplicate detection
-- at the database rather than trusting every code path to check first.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_active_checksum_idx
  ON knowledge_documents (department_id, checksum)
  WHERE status <> 'archived';
