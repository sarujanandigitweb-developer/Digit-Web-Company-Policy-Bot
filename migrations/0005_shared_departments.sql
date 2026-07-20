-- 0005_shared_departments.sql — shared (company-wide) knowledge.
--
-- Apply with the DIRECT host:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f migrations/0005_shared_departments.sql
--
-- Adds an is_shared flag to departments. A shared department's documents are
-- searchable from every department, which is what replaces the old global
-- fallback: a scoped search now covers the selected department plus shared,
-- and nothing else. Additive and idempotent.

BEGIN;

-- When true, this department's knowledge is available to every department search.
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

-- Partial index: retrieval ORs in "OR department is shared", so the planner only
-- needs the handful of shared rows, never a scan of the rest.
CREATE INDEX IF NOT EXISTS departments_is_shared_idx ON departments (id) WHERE is_shared;

-- The company-wide bucket. Hidden from the user picker (is_shared departments are
-- excluded there); admins upload handbook / leave / conduct policies into it.
INSERT INTO departments (slug, name, description, status, is_shared)
VALUES (
  'shared',
  'Shared',
  'Company-wide policies available from every department (e.g. handbook, leave, conduct, working hours).',
  'active',
  true
)
ON CONFLICT (slug) DO UPDATE SET is_shared = true;

COMMIT;
