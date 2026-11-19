-- =====================================================================
--  Vendor profile: unique shop name + single profile picture
--  Run once in pgAdmin (Query Tool) on the database the app uses.
--  Safe to re-run.
--
--  "stallName"  -> no two vendors may share a name, ignoring upper/lower case
--                  and surrounding spaces ("Chicken Rice" blocks "chicken rice ").
--  "logoUrl"    -> one column = at most one profile picture per vendor.
--
--  If the index fails with "could not create unique index", two vendors already
--  share a name. Rename one of them (UPDATE "Vendor" SET "stallName" = ...) and re-run.
-- =====================================================================

ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_stallName_unique"
    ON "Vendor" (lower(btrim("stallName")));

-- ---------------------------------------------------------------------
--  Profile pictures are stored IN the database, not as files in the project.
--  One row per vendor ("vendorId" is the primary key), so a vendor can only
--  ever have one picture. Deleting a vendor deletes their picture.
--  The app shows it through GET /vendors/:id/logo and points "logoUrl" there.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "VendorLogo" (
    "vendorId"  INTEGER PRIMARY KEY REFERENCES "Vendor"("id") ON DELETE CASCADE,
    "data"      BYTEA       NOT NULL CHECK (octet_length("data") BETWEEN 1 AND 1048576),
    "mimeType"  TEXT        NOT NULL CHECK ("mimeType" IN ('image/png', 'image/jpeg', 'image/webp')),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
