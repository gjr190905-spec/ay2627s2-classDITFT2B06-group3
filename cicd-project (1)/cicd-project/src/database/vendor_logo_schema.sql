-- =====================================================================
--  Add this to the project's schema.sql (the file `npm run migration:reset` runs)
--  so the picture table is rebuilt with everything else.
--
--  1. Put the DROP line with the other DROP TABLE lines at the top,
--     BEFORE "Vendor" is dropped (the picture table depends on it).
--  2. Put the CREATE TABLE block anywhere AFTER CREATE TABLE "Vendor".
-- =====================================================================

DROP TABLE IF EXISTS "VendorLogo";

-- Profile pictures are stored in the database, one row per vendor.
CREATE TABLE "VendorLogo" (
    "vendorId"  INTEGER PRIMARY KEY REFERENCES "Vendor"("id") ON DELETE CASCADE,
    "data"      BYTEA       NOT NULL CHECK (octet_length("data") BETWEEN 1 AND 1048576),
    "mimeType"  TEXT        NOT NULL CHECK ("mimeType" IN ('image/png', 'image/jpeg', 'image/webp')),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
