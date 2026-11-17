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
