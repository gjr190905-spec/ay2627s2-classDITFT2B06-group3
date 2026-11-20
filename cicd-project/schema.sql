
-- ---------------------------------------------------------
-- Makan Liao - Database Schema
-- ---------------------------------------------------------
-- Single source of truth for the database structure.
-- Update this file whenever tables, columns, or indexes change.
--
-- Used by: scripts/reset.js
--
-- WARNING:
-- Running the reset script deletes existing tables and data.
-- Never run it against the shared Neon production database.
-- ---------------------------------------------------------

-- Drop existing tables in dependency order
DROP TABLE IF EXISTS "PersonCredential" CASCADE;
DROP TABLE IF EXISTS "Something" CASCADE;
DROP TABLE IF EXISTS "Person" CASCADE;

-- ---------------------------------------------------------
-- Something table (existing team functionality)
-- ---------------------------------------------------------

CREATE TABLE "Something" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "Something_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------
-- Person table (existing fields + account role)
-- ---------------------------------------------------------

CREATE TABLE "Person" (
  "id" SERIAL NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "avatar" TEXT,
  "role" TEXT NOT NULL DEFAULT 'customer',
  CONSTRAINT "Person_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Person_role_check"
    CHECK ("role" IN ('customer', 'staff', 'vendor', 'admin'))
);

-- ---------------------------------------------------------
-- PersonCredential table (secure password storage)
-- ---------------------------------------------------------

CREATE TABLE "PersonCredential" (
  "personId" INTEGER PRIMARY KEY
    REFERENCES "Person"("id") ON DELETE CASCADE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------

-- Preserve the existing unique email constraint.
CREATE UNIQUE INDEX "Person_email_key"
ON "Person"("email");

-- Prevent accounts that differ only in email letter case.
CREATE UNIQUE INDEX "Person_email_ci_key"
ON "Person"(LOWER("email"));
