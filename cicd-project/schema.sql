-- ─────────────────────────────────────────────────────────
--  Database Schema
-- ─────────────────────────────────────────────────────────
--  Single source of truth for the database structure.
--  Update this file whenever you add, remove, or change
--  tables, columns, or indexes.
--
--  Used by: scripts/reset.js
-- ─────────────────────────────────────────────────────────

-- Drop existing tables
DROP TABLE IF EXISTS "VendorLogo" CASCADE;
DROP TABLE IF EXISTS "StoreClosure" CASCADE;
DROP TABLE IF EXISTS "Vendor" CASCADE;
DROP TABLE IF EXISTS "Something" CASCADE;
DROP TABLE IF EXISTS "Person" CASCADE;

-- Create tables
CREATE TABLE "Something" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "Something_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Person" (
  "id" SERIAL NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "avatar" TEXT,
  CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- ── Vendor (stall owners on Makan Liao?) ─────────────────
--  "logoUrl"  : the vendor's configured image, shown in the header
--  "isOpen"   : whether the stall is currently accepting orders
CREATE TABLE "Vendor" (
  "id" SERIAL NOT NULL,
  "email" TEXT NOT NULL,
  "stallName" TEXT NOT NULL,
  "logoUrl" TEXT,
  "isOpen" BOOLEAN NOT NULL DEFAULT FALSE,
  "statusUpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- ── VendorLogo (the vendor's profile picture, stored in the database) ──
--  One row per vendor ("vendorId" is the primary key), so a vendor can only
--  ever have one picture. Deleting a vendor deletes their picture.
--  The app serves it at GET /vendors/:id/logo and points "Vendor"."logoUrl" there.
CREATE TABLE "VendorLogo" (
  "vendorId" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "mimeType" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "VendorLogo_pkey" PRIMARY KEY ("vendorId"),
  CONSTRAINT "VendorLogo_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "Vendor"("id") ON DELETE CASCADE,
  CONSTRAINT "VendorLogo_data_check" CHECK (octet_length("data") BETWEEN 1 AND 1048576),
  CONSTRAINT "VendorLogo_mimeType_check" CHECK (
    "mimeType" IN ('image/png', 'image/jpeg', 'image/webp')
  )
);

-- ── StoreClosure (one row each time a vendor closes) ────
--  "reason"      : one of the fixed codes the UI offers
--  "otherReason" : free text, required only when reason = 'OTHER'
CREATE TABLE "StoreClosure" (
  "id" SERIAL NOT NULL,
  "vendorId" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "otherReason" TEXT,
  "closedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "StoreClosure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StoreClosure_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "Vendor"("id") ON DELETE CASCADE,
  CONSTRAINT "StoreClosure_reason_check" CHECK (
    "reason" IN ('SOLD_OUT', 'BREAK', 'END_OF_DAY', 'EQUIPMENT', 'STAFF', 'OTHER')
  ),
  CONSTRAINT "StoreClosure_otherReason_check" CHECK (
    ("reason" = 'OTHER') = ("otherReason" IS NOT NULL)
  )
);

-- Indexes
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");
-- Shop names are unique, ignoring upper/lower case and outer spaces.
-- Vendor.model.js relies on this to reject a name that is already taken.
CREATE UNIQUE INDEX "Vendor_stallName_unique" ON "Vendor"(lower(btrim("stallName")));
CREATE INDEX "StoreClosure_vendorId_idx" ON "StoreClosure"("vendorId");
