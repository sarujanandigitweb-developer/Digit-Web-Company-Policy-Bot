-- Existing approved documents: scanning must never change what the chatbot can see.
-- Visibility changes only through an explicit, published reviewer decision.
-- Unpublished UPLOADS remain protected by is_searchable=false (set at processing),
-- so this view no longer needs a per-scan quarantine clause.
-- Safe to re-run. Apply after 0012 and 0013.
BEGIN;

CREATE OR REPLACE VIEW knowledge_search_chunks AS
SELECT c.*, COALESCE(c.approved_content, c.content) AS searchable_content
FROM knowledge_chunks c
WHERE c.is_searchable;

-- New decision: the incoming passage is withheld and the conflict is left open on
-- purpose. The existing source is untouched, and the chatbot discloses the conflict.
ALTER TABLE knowledge_chunk_reviews DROP CONSTRAINT IF EXISTS knowledge_chunk_reviews_decision_check;
ALTER TABLE knowledge_chunk_reviews ADD CONSTRAINT knowledge_chunk_reviews_decision_check
  CHECK (decision IN ('include','keep_existing','use_incoming','excerpt','distinct','unresolved'));

COMMIT;
