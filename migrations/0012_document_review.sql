-- Apply before deploying the review feature, with psql -v ON_ERROR_STOP=1 -f.
-- Do NOT wrap this entire file in one transaction: the enum value must commit first.
ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'pending_review' BEFORE 'active';

BEGIN;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'none'
  CHECK (review_state IN ('none','queued','comparing','ready','error','published'));
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS review_origin text NOT NULL DEFAULT 'upload'
  CHECK (review_origin IN ('upload','existing'));
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS review_basis text;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS review_run uuid;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS review_error text;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Existing documents remain available until explicitly scanned. New chunks are
-- inserted with is_searchable=false and cannot bypass the publication gate.
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS is_searchable boolean NOT NULL DEFAULT true;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS approved_content text;

CREATE TABLE IF NOT EXISTS knowledge_chunk_reviews (
  chunk_id uuid PRIMARY KEY REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  incoming_content text NOT NULL,
  kind text CHECK (kind IN ('new','duplicate','overlap','conflict','uncertain')),
  matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision text CHECK (decision IN ('include','keep_existing','use_incoming','excerpt','distinct')),
  approved_excerpt text,
  note text,
  reviewed_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  CHECK (decision <> 'excerpt' OR length(trim(approved_excerpt)) > 0)
);
CREATE INDEX IF NOT EXISTS knowledge_chunk_reviews_document_idx ON knowledge_chunk_reviews(document_id);

-- Also block the OTHER side of an unresolved conflict found in an existing
-- document scan. Unpublished uploads never withdraw the approved live source.
CREATE OR REPLACE VIEW knowledge_search_chunks AS
SELECT c.*, COALESCE(c.approved_content, c.content) AS searchable_content
FROM knowledge_chunks c
WHERE c.is_searchable AND NOT EXISTS (
  SELECT 1 FROM knowledge_chunk_reviews r
  JOIN knowledge_documents reviewing ON reviewing.id = r.document_id
  CROSS JOIN LATERAL jsonb_array_elements(r.matches) m
  WHERE reviewing.status IN ('active','pending_review') AND reviewing.review_origin = 'existing'
    AND reviewing.review_state <> 'published'
    AND ((r.chunk_id=c.id AND r.kind IN ('conflict','uncertain','overlap'))
      OR (m->>'chunk_id' = c.id::text AND m->>'relation' IN ('conflict','uncertain','overlap')))
);

-- A conservative snapshot: ANY live content change in the applicable scope
-- invalidates the review. It deliberately ignores temporary scan quarantine.
CREATE OR REPLACE FUNCTION knowledge_review_basis(target uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT md5(COALESCE((
    SELECT string_agg(concat_ws('|', c.id, d.id, d.title, d.version, c.heading,
      c.page_number, md5(COALESCE(c.approved_content,c.content))), E'\n' ORDER BY c.id)
    FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id
    JOIN departments dep ON dep.id=d.department_id
    WHERE d.status='active' AND c.is_searchable AND d.id<>incoming.id
      AND (incoming_dep.is_shared OR dep.is_shared OR d.department_id=incoming.department_id)
  ),'') || incoming.title || COALESCE(incoming.description,'') || incoming.version::text || incoming.department_id::text || incoming_dep.is_shared::text || COALESCE(incoming.supersedes_id::text,'') ||
    COALESCE((SELECT string_agg(concat_ws('|', own.id,own.is_searchable,own.heading,own.page_number,
      md5(own.content),md5(COALESCE(own.approved_content,own.content))), E'\n' ORDER BY own.id)
      FROM knowledge_chunks own WHERE own.document_id=incoming.id),''))
  FROM knowledge_documents incoming JOIN departments incoming_dep ON incoming_dep.id=incoming.department_id
  WHERE incoming.id=target;
$$;
COMMIT;
