-- 0002_seed.sql — the five departments.
--
-- Idempotent: safe to re-run. Slugs are the stable keys application code uses;
-- names are display text and may be edited from the admin UI without breaking code.

BEGIN;

INSERT INTO departments (slug, name, description) VALUES
  ('hr',         'HR',         'Leave, conduct, working hours, recruitment and employee relations'),
  ('finance',    'Finance',    'Payroll, reimbursements, procurement and financial controls'),
  ('it',         'IT',         'Systems access, security policy, equipment and support'),
  ('operations', 'Operations', 'Day-to-day processes, service delivery and internal workflows'),
  ('marketing',  'Marketing',  'Brand, communications, content and campaign guidelines')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
