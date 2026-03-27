-- Optional work email used to match Azure AD sign-in for self-service PTO/Sick view.
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS login_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_employees_login_email_lower
  ON payroll.employees (lower(trim(login_email)))
  WHERE login_email IS NOT NULL AND trim(login_email) <> '';

COMMENT ON COLUMN payroll.employees.login_email IS 'Work email for self-service; must match sign-in email.';
