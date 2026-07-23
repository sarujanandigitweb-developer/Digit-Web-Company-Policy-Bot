-- 0006_rename_staff_to_team_leader.sql — rename the "staff" role to "team_leader".
--
-- Apply with the DIRECT host:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f migrations/0006_rename_staff_to_team_leader.sql
--
-- Renaming the enum VALUE rewrites nothing: every existing profiles.role = 'staff'
-- row reads back as 'team_leader' automatically, because the label is stored by
-- position, not by text. The column default and the require-department CHECK are
-- respelled to match. Must run together with the code change that expects the new
-- label — the app reads profiles.role and matches it against the TypeScript Role
-- union, so a drift between DB and code would break sign-in.

BEGIN;

-- The role itself. Cascades to all rows that currently hold 'staff'.
ALTER TYPE user_role RENAME VALUE 'staff' TO 'team_leader';

-- New accounts default to the least-privileged role, now spelled team_leader.
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'team_leader';

-- Team leaders answer for a department, so they must have one (unchanged rule,
-- renamed to match). Admins and super admins stay unscoped.
ALTER TABLE profiles DROP CONSTRAINT staff_require_department;
ALTER TABLE profiles ADD CONSTRAINT team_leader_require_department
  CHECK (role <> 'team_leader' OR department_id IS NOT NULL);

COMMIT;
