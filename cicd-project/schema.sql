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
DROP TABLE IF EXISTS "MenuBanner" CASCADE;
DROP TABLE IF EXISTS "MenuItemImage" CASCADE;
DROP TABLE IF EXISTS "MenuItem" CASCADE;
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

-- ── MenuItem (the dishes and drinks on a vendor's menu) ──
--  "priceCents"   : price in cents (450 = $4.50), so there are no rounding errors
--  "quantityLeft" : how many are left; NULL means the vendor isn't counting
--  "isSoldOut"    : the vendor's Available / Sold out switch. The customer menu and
--                   checkout validation both read it. When "quantityLeft" is 0 the
--                   item must be sold out (enforced by "MenuItem_zero_left_check").
--  "deletedAt"    : deleted items are hidden, not removed, so future order records
--                   that point at them stay intact
CREATE TABLE "MenuItem" (
  "id" SERIAL NOT NULL,
  "vendorId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceCents" INTEGER NOT NULL,
  "quantityLeft" INTEGER,
  "isSoldOut" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuItem_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "Vendor"("id") ON DELETE CASCADE,
  CONSTRAINT "MenuItem_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 60),
  CONSTRAINT "MenuItem_description_check" CHECK (
    "description" IS NULL OR char_length("description") <= 200
  ),
  CONSTRAINT "MenuItem_priceCents_check" CHECK ("priceCents" BETWEEN 1 AND 99999),
  CONSTRAINT "MenuItem_quantityLeft_check" CHECK (
    "quantityLeft" IS NULL OR "quantityLeft" BETWEEN 0 AND 9999
  ),
  CONSTRAINT "MenuItem_zero_left_check" CHECK ("quantityLeft" IS DISTINCT FROM 0 OR "isSoldOut")
);

-- ── MenuItemImage (one photo per menu item, stored in the database) ──
--  "itemId" is the primary key, so an item can only ever have one photo.
--  Served at GET /vendors/:vendorId/menu/items/:itemId/image.
CREATE TABLE "MenuItemImage" (
  "itemId" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "mimeType" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "MenuItemImage_pkey" PRIMARY KEY ("itemId"),
  CONSTRAINT "MenuItemImage_itemId_fkey" FOREIGN KEY ("itemId")
    REFERENCES "MenuItem"("id") ON DELETE CASCADE,
  CONSTRAINT "MenuItemImage_data_check" CHECK (octet_length("data") BETWEEN 1 AND 1048576),
  CONSTRAINT "MenuItemImage_mimeType_check" CHECK (
    "mimeType" IN ('image/png', 'image/jpeg', 'image/webp')
  )
);

-- ── MenuBanner (the banner across the top of a vendor's menu page) ──
--  "vendorId" is the primary key, so only one banner can exist per vendor;
--  uploading a new one replaces it. Served at GET /vendors/:vendorId/menu/banner.
CREATE TABLE "MenuBanner" (
  "vendorId" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "mimeType" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "MenuBanner_pkey" PRIMARY KEY ("vendorId"),
  CONSTRAINT "MenuBanner_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "Vendor"("id") ON DELETE CASCADE,
  CONSTRAINT "MenuBanner_data_check" CHECK (octet_length("data") BETWEEN 1 AND 1048576),
  CONSTRAINT "MenuBanner_mimeType_check" CHECK (
    "mimeType" IN ('image/png', 'image/jpeg', 'image/webp')
  )
);

-- Indexes
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");
-- Shop names are unique, ignoring upper/lower case and outer spaces.
-- Vendor.model.js relies on this to reject a name that is already taken.
CREATE UNIQUE INDEX "Vendor_stallName_unique" ON "Vendor"(lower(btrim("stallName")));
CREATE INDEX "StoreClosure_vendorId_idx" ON "StoreClosure"("vendorId");
-- A vendor can't have two menu items with the same name (ignoring case and outer
-- spaces). Deleted items don't count, so a name can be reused after deleting.
CREATE UNIQUE INDEX "MenuItem_vendor_name_unique" ON "MenuItem"("vendorId", lower(btrim("name")))
  WHERE "deletedAt" IS NULL;
CREATE INDEX "MenuItem_vendorId_idx" ON "MenuItem"("vendorId") WHERE "deletedAt" IS NULL;
