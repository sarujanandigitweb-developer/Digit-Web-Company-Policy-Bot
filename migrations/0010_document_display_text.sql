-- 0010_document_display_text.sql — separate what is READ from what is SEARCHED.
--
-- Apply with the DIRECT host:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f migrations/0010_document_display_text.sql
--
-- WHY THIS EXISTS
--
-- DOCX extraction runs through mammoth.convertToMarkdown, which inlines every
-- embedded image as a base64 data: URI. For prose documents that costs nothing.
-- For the LcMA method guides — which are screenshot-heavy, step-by-step SOPs —
-- it is catastrophic:
--
--   LcMA_ebay_..._platform_approach_method_01   2,725,323 chars
--                                               36 inline images
--                                               3,279 chars of actual text
--
-- 99.9% of the stored "text" was image data. The chunker split that base64 into
-- ~2,270 chunks of binary, the embedding API rejected them, and the document
-- ended at status='failed' with 0 chunks — so it could never be retrieved and
-- never appear in the Knowledge Library.
--
-- The two concerns were conflated in one column. They are now separated:
--
--   extracted_text  → text only, no images. Chunked and embedded. Searchable.
--   display_text    → the full markdown INCLUDING images. Read by a person.
--
-- display_text is NULL when the two would be identical, so documents without
-- images cost nothing extra.
--
-- Additive and idempotent. No existing column changes meaning for a document
-- that has no inline images, which is every document uploaded before today.

BEGIN;

-- The reading copy: full markdown with images kept. NULL means "same as
-- extracted_text" — the reader falls back to it, so nothing needs backfilling
-- for documents that never had images.
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS display_text text;

-- Backfill: move the images out of the searchable column and into the reading
-- column, for the rows that actually carry them. Matching on the markdown image
-- construct ![alt](data:…) rather than on the URI alone, so no stray "![]()"
-- is left behind in the text the chunker will read.
WITH affected AS (
  SELECT id, extracted_text
    FROM knowledge_documents
   WHERE extracted_text LIKE '%](data:image%'
     AND display_text IS NULL
)
UPDATE knowledge_documents d
   SET display_text   = a.extracted_text,
       extracted_text = regexp_replace(a.extracted_text, '!\[[^]]*\]\(data:[^)]*\)', '', 'g')
  FROM affected a
 WHERE d.id = a.id;

COMMIT;
