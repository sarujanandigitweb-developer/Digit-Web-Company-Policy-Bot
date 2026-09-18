-- 0008_knowledge_library.sql — the Knowledge Library hierarchy.
--
-- Apply with the DIRECT host:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f migrations/0008_knowledge_library.sql
--
-- Additive and idempotent. Nothing here changes retrieval, chunking, embedding
-- or any existing column's meaning.
--
-- Why a self-referencing tree rather than five columns: the source hierarchy is
-- ragged. A resource can sit directly under a Model (Bietrick's handbook), under
-- a Section (Farshad's title guide), or under a Method. A fixed-depth table
-- would have to invent empty levels to hold them; a parent pointer does not.

BEGIN;

-- ---------------------------------------------------------------------------
-- knowledge_folders — one node of the library tree.
--
-- `kind` is presentation, not structure: the tree is walked by parent_id alone,
-- so adding a level later needs no migration. It exists so the UI can pick an
-- icon and label without guessing from the name.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: deleting a branch removes its nodes. Documents are NOT part of the
  -- cascade — see knowledge_documents.folder_id below.
  parent_id  uuid REFERENCES knowledge_folders(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  -- "Thineshkaran's", "Bietrick's" — shown under the model name.
  owner_name text,
  kind       text NOT NULL CHECK (kind IN ('root', 'platform', 'model', 'section', 'method')),
  -- Reference back to the source folder. Display only; nothing reads from it.
  drive_url  text,
  -- Keeps "00. Platform approach" above "01. Title" without parsing the name.
  sort_order int  NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One name per parent. COALESCE because NULL parents (roots) would otherwise
-- never collide, and the seed must stay idempotent at the root too.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_folders_parent_name_idx
  ON knowledge_folders (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

-- The tree read: children of a node, already ordered.
CREATE INDEX IF NOT EXISTS knowledge_folders_parent_idx
  ON knowledge_folders (parent_id, sort_order, name);

DROP TRIGGER IF EXISTS knowledge_folders_updated_at ON knowledge_folders;
CREATE TRIGGER knowledge_folders_updated_at BEFORE UPDATE ON knowledge_folders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- knowledge_documents — two nullable additions.
--
-- folder_id is ON DELETE SET NULL, deliberately unlike the folder cascade:
-- removing a folder must never destroy a document or the chunks hanging off it.
-- Same rule as the rest of this schema — structure cascades, history does not.
-- ---------------------------------------------------------------------------
ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES knowledge_folders(id) ON DELETE SET NULL;

-- Where this resource came from, for the "Open original" link. Display only.
ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS source_url text;

-- The library's hot path: active resources in one folder.
CREATE INDEX IF NOT EXISTS knowledge_documents_folder_idx
  ON knowledge_documents (folder_id, status);

COMMIT;
