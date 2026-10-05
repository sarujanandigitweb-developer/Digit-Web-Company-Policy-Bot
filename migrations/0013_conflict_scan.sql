-- Library-wide conflict scan (read-only findings). Additive only: it does not
-- change knowledge_chunks, knowledge_documents or retrieval. Safe to re-run.
BEGIN;

-- One row per scan run. The cursor is the last active passage (ordered by id)
-- whose candidates have been compared. Stepping is compare-and-set on the cursor,
-- so a double-click or a second reviewer cannot apply the same step twice.
CREATE TABLE IF NOT EXISTS knowledge_conflict_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete')),
  cursor_chunk_id uuid,
  chunks_total integer NOT NULL DEFAULT 0 CHECK (chunks_total >= 0),
  chunks_done integer NOT NULL DEFAULT 0 CHECK (chunks_done >= 0),
  started_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Every compared passage pair, stored once (chunk_low < chunk_high). Storing
-- 'new' results too is what makes the scan deduplicate and resume: a pair is
-- never classified twice, from either side.
CREATE TABLE IF NOT EXISTS knowledge_pair_comparisons (
  chunk_low uuid NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  chunk_high uuid NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  relation text NOT NULL CHECK (relation IN ('new', 'duplicate', 'overlap', 'conflict', 'uncertain')),
  explanation text NOT NULL DEFAULT '',
  scan_id uuid NOT NULL REFERENCES knowledge_conflict_scans(id) ON DELETE CASCADE,
  compared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_low, chunk_high),
  CHECK (chunk_low < chunk_high)
);

CREATE INDEX IF NOT EXISTS knowledge_pair_comparisons_findings_idx
  ON knowledge_pair_comparisons (relation) WHERE relation <> 'new';

COMMIT;
