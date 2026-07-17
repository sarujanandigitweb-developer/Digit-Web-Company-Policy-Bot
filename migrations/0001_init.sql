-- 0001_init.sql — admin management system + department knowledge base
--
-- Apply with the DIRECT (non-pooler) host:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f migrations/0001_init.sql
--
-- Auth tables (user, session, account) are owned by Neon Auth in the `neon_auth`
-- schema and are NOT created here. This migration only adds application data and
-- references neon_auth."user"(id), which is uuid.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;    -- 0.8.1 — knowledge_chunks.embedding
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- 1.6   — fuzzy grouping of asked questions

-- ---------------------------------------------------------------------------
-- Enums
--
-- Fixed domains are enums so the database rejects bad values. Deliberately NOT
-- an enum: ai_provider_logs.provider / .model. The gateway is designed so that
-- adding a provider is one object in PROVIDER_CHAIN; an enum would force a
-- migration every time, so those stay text and are validated in the app.
-- ---------------------------------------------------------------------------
CREATE TYPE user_role          AS ENUM ('super_admin', 'admin', 'staff');
CREATE TYPE user_status        AS ENUM ('active', 'suspended');
CREATE TYPE department_status  AS ENUM ('active', 'inactive');
CREATE TYPE document_file_type AS ENUM ('pdf', 'docx', 'txt', 'md');
CREATE TYPE message_role       AS ENUM ('user', 'assistant');
CREATE TYPE gap_status         AS ENUM ('pending', 'reviewed', 'resolved');
CREATE TYPE attempt_outcome    AS ENUM ('success', 'failed', 'timeout');
CREATE TYPE feedback_rating    AS ENUM ('up', 'down');

-- A document is not simply on/off: ingestion (parse → chunk → embed) is async and
-- can fail, and replacing a document must retire the old one without deleting it.
CREATE TYPE document_status    AS ENUM ('processing', 'active', 'inactive', 'failed', 'archived');

-- Shared updated_at trigger.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable key for application code and URLs. Renaming a department must not
  -- break code, so code joins on slug, never on the display name.
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_-]*$'),
  name        text NOT NULL,
  description text,
  status      department_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER departments_updated_at BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles — application data for an authenticated user.
--
-- Extends neon_auth."user" rather than duplicating it: email, password hash and
-- sessions stay owned by Neon Auth. user_id is both PK and FK, enforcing 1:1.
--
-- neon_auth."user" also has its own `role text` column (Better Auth's admin
-- plugin). We deliberately do not use it: it is untyped text in a schema Neon
-- manages, and two writable role columns would eventually disagree. profiles.role
-- is the single source of truth for authorization.
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  user_id       uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  full_name     text,
  role          user_role NOT NULL DEFAULT 'staff',
  -- Home department. NULL for admins, who are not scoped to one.
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  status        user_status NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Staff answer questions for a department, so they must have one. Admins and
  -- super admins see every department and must not be pinned to a single one.
  CONSTRAINT staff_require_department
    CHECK (role <> 'staff' OR department_id IS NOT NULL)
);
CREATE INDEX profiles_role_idx       ON profiles (role);
CREATE INDEX profiles_department_idx ON profiles (department_id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- knowledge_documents — one uploaded file, owned by exactly one department.
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  title           text NOT NULL,
  description     text,
  file_name       text NOT NULL,
  file_type       document_file_type NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  -- sha256 of the file. Lets "Replace" detect a re-upload of identical content
  -- and skip re-embedding, which is the expensive part of ingestion.
  checksum        text NOT NULL,
  -- Object storage key (Vercel Blob / S3). The DB stores the reference only.
  storage_key     text NOT NULL,

  version         int NOT NULL DEFAULT 1 CHECK (version > 0),
  -- Replace = insert a new row pointing at the row it retires, so citations on
  -- historical answers keep resolving instead of dangling.
  supersedes_id   uuid REFERENCES knowledge_documents(id) ON DELETE SET NULL,

  status           document_status NOT NULL DEFAULT 'processing',
  processing_error text,          -- populated when status = 'failed'
  chunk_count      int NOT NULL DEFAULT 0,

  uploaded_by     uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- The chatbot's hot path: active documents in one department.
CREATE INDEX knowledge_documents_dept_status_idx ON knowledge_documents (department_id, status);
CREATE INDEX knowledge_documents_checksum_idx    ON knowledge_documents (checksum);
CREATE INDEX knowledge_documents_uploaded_by_idx ON knowledge_documents (uploaded_by);
CREATE TRIGGER knowledge_documents_updated_at BEFORE UPDATE ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- knowledge_chunks — retrieval unit.
--
-- department_id is denormalized from the parent document on purpose: every
-- search filters by department, and carrying it here keeps the filter off a join
-- with the vector scan. A trigger keeps it honest.
--
-- embedding is vector(1536), NOT the 3072 dims gemini-embedding-001 returns by
-- default: pgvector rejects an HNSW index above 2000 dims, which would make every
-- search a sequential scan. Request outputDimensionality=1536 when embedding.
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  chunk_index   int  NOT NULL CHECK (chunk_index >= 0),
  content       text NOT NULL,
  -- Nearest enclosing heading, e.g. "6.1 General Leave Guidelines". The current
  -- bot recovers these by regexing the model's prose; here they are real data.
  heading       text,
  token_count   int,
  embedding     vector(1536) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE OR REPLACE FUNCTION knowledge_chunks_sync_department() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT department_id INTO NEW.department_id
  FROM knowledge_documents WHERE id = NEW.document_id;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_chunks_department BEFORE INSERT OR UPDATE OF document_id
  ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION knowledge_chunks_sync_department();

-- Cosine distance: gemini embeddings truncated below 3072 are not re-normalized,
-- and cosine is scale-invariant, so it stays correct where inner product wouldn't.
CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX knowledge_chunks_department_idx ON knowledge_chunks (department_id);
CREATE INDEX knowledge_chunks_document_idx   ON knowledge_chunks (document_id);
-- Keyword half of hybrid search: vectors alone miss exact terms like "48 hours".
CREATE INDEX knowledge_chunks_content_trgm_idx ON knowledge_chunks
  USING gin (content gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- chat_sessions / chat_messages
-- ---------------------------------------------------------------------------
CREATE TABLE chat_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: the chatbot is public today. Once login is enforced this becomes
  -- NOT NULL; leaving it nullable lets sessions be logged before that lands.
  user_id         uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  -- Department the session is scoped to. NULL means a global search.
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  title           text,
  is_global_search boolean NOT NULL DEFAULT false,
  started_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_sessions_user_idx    ON chat_sessions (user_id, started_at DESC);
CREATE INDEX chat_sessions_dept_idx    ON chat_sessions (department_id);
CREATE INDEX chat_sessions_started_idx ON chat_sessions (started_at DESC);
CREATE TRIGGER chat_sessions_updated_at BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role             message_role NOT NULL,
  content          text NOT NULL,
  -- Assistant only. Retrieval confidence (best chunk similarity); below the
  -- configured floor the answer is recorded as a knowledge gap.
  confidence_score real CHECK (confidence_score BETWEEN 0 AND 1),
  responded_in_ms  int,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT confidence_only_on_assistant
    CHECK (role = 'assistant' OR confidence_score IS NULL)
);
CREATE INDEX chat_messages_session_idx ON chat_messages (session_id, created_at);
CREATE INDEX chat_messages_created_idx ON chat_messages (created_at DESC);
-- "Most asked questions" groups similar user questions by trigram similarity.
CREATE INDEX chat_messages_user_content_trgm_idx ON chat_messages
  USING gin (content gin_trgm_ops) WHERE role = 'user';

-- ---------------------------------------------------------------------------
-- message_citations — which chunks produced an answer.
--
-- Not in the original table list, but required by two features: source chips
-- that are real data instead of regexed prose, and "link a resolved gap to the
-- knowledge document" (impossible without recorded provenance).
-- ---------------------------------------------------------------------------
CREATE TABLE message_citations (
  message_id uuid NOT NULL REFERENCES chat_messages(id)   ON DELETE CASCADE,
  chunk_id   uuid NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  similarity real NOT NULL,
  rank       int  NOT NULL,
  PRIMARY KEY (message_id, chunk_id)
);
CREATE INDEX message_citations_chunk_idx ON message_citations (chunk_id);

-- ---------------------------------------------------------------------------
-- knowledge_gaps
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_gaps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question             text NOT NULL,
  department_id        uuid REFERENCES departments(id)        ON DELETE SET NULL,
  session_id           uuid REFERENCES chat_sessions(id)      ON DELETE SET NULL,
  message_id           uuid REFERENCES chat_messages(id)      ON DELETE SET NULL,
  asked_by             uuid REFERENCES neon_auth."user"(id)   ON DELETE SET NULL,
  confidence_score     real NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  ai_response          text,
  status               gap_status NOT NULL DEFAULT 'pending',
  -- The same missing policy gets asked repeatedly; counting beats 50 duplicate
  -- rows and makes "gap trends" a real signal about what to write next.
  occurrence_count     int NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  last_asked_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_by          uuid REFERENCES neon_auth."user"(id)   ON DELETE SET NULL,
  reviewed_at          timestamptz,
  resolution_note      text,
  resolved_document_id uuid REFERENCES knowledge_documents(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_gaps_status_idx  ON knowledge_gaps (status, last_asked_at DESC);
CREATE INDEX knowledge_gaps_dept_idx    ON knowledge_gaps (department_id, status);
CREATE INDEX knowledge_gaps_question_trgm_idx ON knowledge_gaps USING gin (question gin_trgm_ops);
CREATE TRIGGER knowledge_gaps_updated_at BEFORE UPDATE ON knowledge_gaps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- ai_provider_logs — one row per provider ATTEMPT, not per message.
--
-- The gateway walks a fallback chain, so a single answer can produce several
-- rows: gemini failed(503) → groq failed(404) → openrouter success. Modelling
-- this per-message would throw away exactly the fallback data worth having.
-- ---------------------------------------------------------------------------
CREATE TABLE ai_provider_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
  session_id        uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,
  provider          text NOT NULL,   -- matches ProviderId in providers.server.ts
  model             text NOT NULL,
  attempt_index     int  NOT NULL CHECK (attempt_index >= 0),  -- 0 = first tried
  outcome           attempt_outcome NOT NULL,
  error_reason      text,
  http_status       int,
  latency_ms        int,
  prompt_tokens     int,
  completion_tokens int,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_provider_logs_provider_idx ON ai_provider_logs (provider, created_at DESC);
CREATE INDEX ai_provider_logs_created_idx  ON ai_provider_logs (created_at DESC);
CREATE INDEX ai_provider_logs_outcome_idx  ON ai_provider_logs (outcome, created_at DESC);
CREATE INDEX ai_provider_logs_message_idx  ON ai_provider_logs (message_id);

-- ---------------------------------------------------------------------------
-- audit_logs — bigserial, not uuid: append-only, high volume, always read in
-- time order, and never referenced by another table.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  action     text NOT NULL,   -- 'user.role_changed', 'document.deleted'
  table_name text,
  record_id  text,            -- text, so it holds any PK type
  old_value  jsonb,
  new_value  jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_idx  ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_table_idx  ON audit_logs (table_name, record_id);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- feedback
-- ---------------------------------------------------------------------------
CREATE TABLE feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  rating     feedback_rating NOT NULL,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One verdict per person per answer; a second submission updates the first.
  UNIQUE (message_id, user_id)
);
CREATE INDEX feedback_message_idx ON feedback (message_id);
CREATE INDEX feedback_rating_idx  ON feedback (rating, created_at DESC);

COMMIT;
