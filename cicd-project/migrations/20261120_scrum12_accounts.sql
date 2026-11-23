
-- ---------------------------------------------------------
-- SCRUM-12: PostgreSQL Account Persistence Migration
-- ---------------------------------------------------------
-- Prepares existing Person records for authenticated accounts.
-- Preserves existing Person and Something table data.
-- Password hashes are stored separately from public profiles.
-- ---------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------
-- 1. Add role column to existing Person table
-- ---------------------------------------------------------

ALTER TABLE "Person"
ADD COLUMN IF NOT EXISTS "role"
TEXT NOT NULL DEFAULT 'customer';

-- ---------------------------------------------------------
-- 2. Restrict account roles to permitted values
-- ---------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Person_role_check'
      AND conrelid = '"Person"'::regclass
  ) THEN
    ALTER TABLE "Person"
    ADD CONSTRAINT "Person_role_check"
    CHECK ("role" IN ('customer', 'staff', 'vendor', 'admin'));
  END IF;
END
$$;

-- ---------------------------------------------------------
-- 3. Create separate table for password hashes
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS "PersonCredential" (
  "personId" INTEGER PRIMARY KEY
    REFERENCES "Person"("id") ON DELETE CASCADE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------
-- 4. Prevent duplicate emails differing only by case
-- ---------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "Person_email_ci_key"
ON "Person"(LOWER("email"));

COMMIT;
