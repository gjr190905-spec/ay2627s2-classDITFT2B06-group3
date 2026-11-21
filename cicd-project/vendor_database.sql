-- =====================================================================
--  Makan Liao? – complete database setup (one file for pgAdmin)
--
--  HOW TO RUN
--    pgAdmin -> right-click the database the app uses (dbdev, see .env.dev)
--    -> Query Tool -> open or paste this file -> Execute (F5).
--
--  WARNING: this REBUILDS the app's tables. Every vendor, closure record,
--  profile picture, menu item, item photo, menu banner, order, setting, notification, person and something
--  in them is deleted and replaced
--  with the sample data at the bottom. It does the same as
--  `npm run migration:reset`, so the two always give the same database.
--
--  Safe to run again at any time (it simply rebuilds again).
--
--  Combines: schema.sql, vendor_profile_migration.sql, vendor_logo_schema.sql,
--  vendor_tables.sql and the sample data from scripts/seed.js.
--  If you change tables later, change schema.sql too (the app's tests use it).
-- =====================================================================

SET client_min_messages = warning;   -- hide harmless "does not exist, skipping" notices
SET search_path TO public;           -- always build in "public", where the app looks

BEGIN;   -- all or nothing: if any step fails, nothing is changed

-- ---------------------------------------------------------------------
-- 1. Remove the old tables (pictures and closures first, they depend on Vendor)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS "VendorNotification" CASCADE;
DROP TABLE IF EXISTS "VendorSettings" CASCADE;
DROP TABLE IF EXISTS "OrderItem" CASCADE;
DROP TABLE IF EXISTS "Order" CASCADE;
DROP FUNCTION IF EXISTS "Order_collected_is_final"() CASCADE;
DROP TABLE IF EXISTS "MenuBanner" CASCADE;
DROP TABLE IF EXISTS "MenuItemImage" CASCADE;
DROP TABLE IF EXISTS "MenuItem" CASCADE;
DROP TABLE IF EXISTS "VendorLogo" CASCADE;
DROP TABLE IF EXISTS "StoreClosure" CASCADE;
DROP TABLE IF EXISTS "Vendor" CASCADE;
DROP TABLE IF EXISTS "Something" CASCADE;
DROP TABLE IF EXISTS "Person" CASCADE;

-- ---------------------------------------------------------------------
-- 2. Starter tables from the project template
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 3. Vendor: one row per stall
--    "stallName" : shop name, unique ignoring upper/lower case and outer spaces
--    "logoUrl"   : where the page loads the picture from (one per vendor)
--    "isOpen"    : whether the stall is accepting orders
-- ---------------------------------------------------------------------
CREATE TABLE "Vendor" (
  "id" SERIAL NOT NULL,
  "email" TEXT NOT NULL,
  "stallName" TEXT NOT NULL,
  "logoUrl" TEXT,
  "isOpen" BOOLEAN NOT NULL DEFAULT FALSE,
  "statusUpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------
-- 4. VendorLogo: the profile picture itself, stored in the database
--    One row per vendor, so a vendor can only ever have one picture.
--    Deleting a vendor deletes their picture.
--    The app serves it at GET /vendors/:id/logo and points "logoUrl" there.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 5. StoreClosure: one row each time a stall closes, with the reason
--    "reason"      : one of the fixed codes the close prompt offers
--    "otherReason" : typed text, required only when reason = 'OTHER'
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 5b. Menu: items (one photo each) and one banner per vendor
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 5c. Orders: pickup orders, their items, and the "collected is final" rule
-- ---------------------------------------------------------------------
-- ── Order (a student's pickup order at one stall) ──
--  "orderNumber"  : the number the student shows at the stall, unique per stall (1001, 1002…)
--  "status"       : CONFIRMED → PREPARING → READY → COLLECTED, one step at a time
--  "pickupWindow*": the window the student booked; the dashboard groups orders by it
--  "totalCents"   : the amount to collect at the stall (students pay on pickup)
--  "readyAt"      : when the vendor marked it Ready, so on-time readiness
--                   ("readyAt" <= "pickupWindowEnd") can be checked
--  "collectedAt"  : when it was handed over. Once COLLECTED the row can't change
--                   (trigger "Order_collected_is_final").
CREATE TABLE "Order" (
  "id" SERIAL NOT NULL,
  "vendorId" INTEGER NOT NULL,
  "orderNumber" INTEGER NOT NULL,
  "customerName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "pickupWindowStart" TIMESTAMPTZ NOT NULL,
  "pickupWindowEnd" TIMESTAMPTZ NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "preparingAt" TIMESTAMPTZ,
  "readyAt" TIMESTAMPTZ,
  "collectedAt" TIMESTAMPTZ,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "Vendor"("id") ON DELETE CASCADE,
  CONSTRAINT "Order_status_check" CHECK (
    "status" IN ('CONFIRMED', 'PREPARING', 'READY', 'COLLECTED')
  ),
  CONSTRAINT "Order_window_check" CHECK ("pickupWindowEnd" > "pickupWindowStart"),
  CONSTRAINT "Order_totalCents_check" CHECK ("totalCents" >= 0),
  CONSTRAINT "Order_customerName_check" CHECK (
    "customerName" IS NULL OR char_length("customerName") <= 60
  ),
  -- Each status has the timestamps of every step before it
  CONSTRAINT "Order_timestamps_check" CHECK (
    ("status" = 'CONFIRMED' AND "readyAt" IS NULL AND "collectedAt" IS NULL)
    OR ("status" = 'PREPARING' AND "preparingAt" IS NOT NULL AND "readyAt" IS NULL
        AND "collectedAt" IS NULL)
    OR ("status" = 'READY' AND "preparingAt" IS NOT NULL AND "readyAt" IS NOT NULL
        AND "collectedAt" IS NULL)
    OR ("status" = 'COLLECTED' AND "preparingAt" IS NOT NULL AND "readyAt" IS NOT NULL
        AND "collectedAt" IS NOT NULL)
  )
);

-- ── OrderItem (the lines of an order) ──
--  Name and price are copied at order time, so later menu edits don't change past orders.
CREATE TABLE "OrderItem" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "menuItemId" INTEGER,
  "name" TEXT NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId")
    REFERENCES "Order"("id") ON DELETE CASCADE,
  CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId")
    REFERENCES "MenuItem"("id") ON DELETE SET NULL,
  CONSTRAINT "OrderItem_unitPriceCents_check" CHECK ("unitPriceCents" >= 0),
  CONSTRAINT "OrderItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99)
);

-- A collected order is final: no second collection (or any other change) can alter it
CREATE FUNCTION "Order_collected_is_final"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'COLLECTED' THEN
    RAISE EXCEPTION 'Order % has already been collected', OLD."orderNumber"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_collected_is_final"
  BEFORE UPDATE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION "Order_collected_is_final"();

-- ---------------------------------------------------------------------
-- 5d. Settings (order limit, notification choices) and notifications
-- ---------------------------------------------------------------------
-- ── VendorSettings (one row per vendor; no row = the defaults below) ──
--  "maxActiveOrders" : how many orders the stall takes on at once, counting orders that
--                      are Confirmed or Preparing. NULL = no limit. At the limit, new
--                      orders (and the checkout check) are refused until some are Ready.
--  "notify*"         : which in-app notifications the vendor wants
--  "lowStockThreshold": "low stock" means this many or fewer left
CREATE TABLE "VendorSettings" (
  "vendorId" INTEGER NOT NULL,
  "maxActiveOrders" INTEGER,
  "notifyNewOrder" BOOLEAN NOT NULL DEFAULT TRUE,
  "notifySoldOut" BOOLEAN NOT NULL DEFAULT TRUE,
  "notifyLowStock" BOOLEAN NOT NULL DEFAULT TRUE,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 3,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "VendorSettings_pkey" PRIMARY KEY ("vendorId"),
  CONSTRAINT "VendorSettings_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "Vendor"("id") ON DELETE CASCADE,
  CONSTRAINT "VendorSettings_maxActiveOrders_check" CHECK (
    "maxActiveOrders" IS NULL OR "maxActiveOrders" BETWEEN 1 AND 200
  ),
  CONSTRAINT "VendorSettings_lowStockThreshold_check" CHECK ("lowStockThreshold" BETWEEN 1 AND 50)
);

-- ── VendorNotification (in-app notifications, newest first) ──
--  Created when orders come in, only for the types the vendor has switched on.
--  "type": NEW_ORDER, SOLD_OUT or LOW_STOCK. "readAt" NULL = unread.
CREATE TABLE "VendorNotification" (
  "id" SERIAL NOT NULL,
  "vendorId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "orderId" INTEGER,
  "menuItemId" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "readAt" TIMESTAMPTZ,
  CONSTRAINT "VendorNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorNotification_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "Vendor"("id") ON DELETE CASCADE,
  CONSTRAINT "VendorNotification_orderId_fkey" FOREIGN KEY ("orderId")
    REFERENCES "Order"("id") ON DELETE SET NULL,
  CONSTRAINT "VendorNotification_menuItemId_fkey" FOREIGN KEY ("menuItemId")
    REFERENCES "MenuItem"("id") ON DELETE SET NULL,
  CONSTRAINT "VendorNotification_type_check" CHECK (
    "type" IN ('NEW_ORDER', 'SOLD_OUT', 'LOW_STOCK')
  ),
  CONSTRAINT "VendorNotification_message_check" CHECK (char_length("message") BETWEEN 1 AND 200)
);

-- ---------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");
-- Shop names are unique, ignoring upper/lower case and outer spaces
-- ("Chicken Rice" blocks "chicken rice "). The app relies on this.
CREATE UNIQUE INDEX "Vendor_stallName_unique" ON "Vendor"(lower(btrim("stallName")));
CREATE INDEX "StoreClosure_vendorId_idx" ON "StoreClosure"("vendorId");
-- A vendor can't have two menu items with the same name (ignoring case and outer
-- spaces). Deleted items don't count, so a name can be reused after deleting.
CREATE UNIQUE INDEX "MenuItem_vendor_name_unique" ON "MenuItem"("vendorId", lower(btrim("name")))
  WHERE "deletedAt" IS NULL;
CREATE INDEX "MenuItem_vendorId_idx" ON "MenuItem"("vendorId") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Order_vendor_orderNumber_key" ON "Order"("vendorId", "orderNumber");
CREATE INDEX "Order_vendor_window_idx" ON "Order"("vendorId", "pickupWindowStart");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "VendorNotification_vendor_idx" ON "VendorNotification"("vendorId", "createdAt" DESC);

-- ---------------------------------------------------------------------
-- 7. Sample data (same as scripts/seed.js)
-- ---------------------------------------------------------------------
INSERT INTO "Person" ("email", "name") VALUES
  ('alice@example.com', 'Alice'),
  ('bob@example.com', 'Bob'),
  ('carol@example.com', 'Carol'),
  ('dave@example.com', 'Dave'),
  ('eve@example.com', 'Eve'),
  ('frank@example.com', 'Frank'),
  ('grace@example.com', 'Grace'),
  ('heidi@example.com', 'Heidi'),
  ('ivan@example.com', 'Ivan'),
  ('judy@example.com', 'Judy'),
  ('mallory@example.com', 'Mallory'),
  ('oscar@example.com', 'Oscar'),
  ('peggy@example.com', 'Peggy'),
  ('trent@example.com', 'Trent'),
  ('victor@example.com', 'Victor'),
  ('walter@example.com', 'Walter'),
  ('xavier@example.com', 'Xavier'),
  ('yvonne@example.com', 'Yvonne'),
  ('zara@example.com', 'Zara'),
  ('leo@example.com', 'Leo');

INSERT INTO "Something" ("name") VALUES
  ('Seed 1'),
  ('Seed 2');

-- Vendor 1 is the one the vendor home page tests use.
-- Kopi Corner has no logo, so the page shows its initials instead.
INSERT INTO "Vendor" ("email", "stallName", "logoUrl", "isOpen") VALUES
  ('ahseng@makanliao.sg', 'Ah Seng Chicken Rice', '/images/vendors/ah-seng-chicken-rice.svg', TRUE),
  ('mdmlim@makanliao.sg', 'Mdm Lim Laksa', '/images/vendors/mdm-lim-laksa.svg', FALSE),
  ('kopi@makanliao.sg', 'Kopi Corner', NULL, TRUE),
  ('wong@makanliao.sg', 'Wong''s Nasi Lemak', NULL, TRUE);

-- Starter menus (prices in cents; quantityLeft NULL = not counting).
-- Vendor 2 (Mdm Lim Laksa) is the one the menu page tests use; vendor 4 (Wong's)
-- the settings tests.
INSERT INTO "MenuItem" ("vendorId", "name", "description", "priceCents", "quantityLeft", "isSoldOut")
SELECT v."id", m."name", m."description", m."priceCents", m."quantityLeft", m."isSoldOut"
FROM (VALUES
  (1, 'ahseng@makanliao.sg', 'Steamed Chicken Rice', 'Poached chicken, fragrant rice, chilli and ginger.', 450, NULL::int, FALSE),
  (2, 'ahseng@makanliao.sg', 'Roasted Chicken Rice', 'Crispy-skin roast chicken with dark soy.', 480, 20, FALSE),
  (3, 'ahseng@makanliao.sg', 'Braised Egg', NULL, 80, 0, TRUE),
  (4, 'mdmlim@makanliao.sg', 'Curry Laksa', 'Rich coconut curry broth with prawns, tau pok and cockles.', 550, NULL, FALSE),
  (5, 'mdmlim@makanliao.sg', 'Mee Siam', 'Tangy, slightly spicy rice vermicelli.', 450, 5, FALSE),
  (6, 'mdmlim@makanliao.sg', 'Otah', 'Grilled spiced fish cake.', 150, NULL, TRUE),
  (7, 'kopi@makanliao.sg', 'Kopi', 'Coffee with condensed milk.', 150, NULL, FALSE),
  (8, 'kopi@makanliao.sg', 'Teh Tarik', 'Pulled milk tea.', 170, NULL, FALSE),
  (9, 'kopi@makanliao.sg', 'Kaya Toast Set', 'Two slices of kaya toast with soft-boiled eggs.', 380, 15, FALSE),
  (10, 'wong@makanliao.sg', 'Nasi Lemak', 'Coconut rice, sambal, egg, anchovies and peanuts.', 400, NULL, FALSE),
  (11, 'wong@makanliao.sg', 'Chicken Wing', 'Fried, crispy, one piece.', 180, 30, FALSE)
) AS m("ord", "email", "name", "description", "priceCents", "quantityLeft", "isSoldOut")
JOIN "Vendor" v ON v."email" = m."email"
ORDER BY m."ord";

-- A few sample orders per stall for today, around the time you run this script:
-- one in each status, so the dashboard has something to show. (scripts/seed.js
-- adds more, including the last 6 days for the sales chart.)
INSERT INTO "Order" ("vendorId", "orderNumber", "customerName", "status", "pickupWindowStart",
  "pickupWindowEnd", "totalCents", "createdAt", "preparingAt", "readyAt", "collectedAt")
SELECT v."id", 1000 + s."n", s."customerName", s."status",
  date_trunc('hour', NOW()) + s."startOffset",
  date_trunc('hour', NOW()) + s."startOffset" + interval '15 minutes',
  m."priceCents" * (1 + (s."n" % 2)), NOW() - interval '1 hour',
  CASE WHEN s."status" <> 'CONFIRMED' THEN NOW() - interval '20 minutes' END,
  CASE WHEN s."status" IN ('READY', 'COLLECTED') THEN NOW() - interval '10 minutes' END,
  CASE WHEN s."status" = 'COLLECTED' THEN NOW() - interval '5 minutes' END
FROM "Vendor" v
-- each sample order is for the stall's first menu item (1 or 2 portions)
JOIN LATERAL (
  SELECT mi."priceCents" FROM "MenuItem" mi WHERE mi."vendorId" = v."id" ORDER BY mi."id" LIMIT 1
) m ON TRUE
CROSS JOIN (VALUES
  (1, 'Alice', 'COLLECTED', interval '-30 minutes'),
  (2, 'Bob', 'READY', interval '-15 minutes'),
  (3, 'Carol', 'PREPARING', interval '0 minutes'),
  (4, 'Dave', 'CONFIRMED', interval '15 minutes')
) AS s("n", "customerName", "status", "startOffset");

-- The matching order lines
INSERT INTO "OrderItem" ("orderId", "menuItemId", "name", "unitPriceCents", "quantity")
SELECT o."id", m."id", m."name", m."priceCents", 1 + (o."orderNumber" % 2)
FROM "Order" o
JOIN LATERAL (
  SELECT * FROM "MenuItem" mi WHERE mi."vendorId" = o."vendorId" ORDER BY mi."id" LIMIT 1
) m ON TRUE;

COMMIT;

-- ---------------------------------------------------------------------
-- 8. Check: should list 12 tables, then the 4 vendors, their menus and today's orders
-- ---------------------------------------------------------------------
SELECT table_name AS "Tables created"
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('Person', 'Something', 'Vendor', 'VendorLogo', 'StoreClosure',
                      'MenuItem', 'MenuItemImage', 'MenuBanner', 'Order', 'OrderItem',
                      'VendorSettings', 'VendorNotification')
 ORDER BY table_name;

SELECT "id", "stallName", "isOpen", "logoUrl" FROM "Vendor" ORDER BY "id";

SELECT "vendorId", "name", "priceCents", "quantityLeft", "isSoldOut" FROM "MenuItem" ORDER BY "id";

SELECT o."vendorId", o."orderNumber", o."status", o."totalCents",
       to_char(o."pickupWindowStart" AT TIME ZONE 'Asia/Singapore', 'HH24:MI') AS "windowStart"
FROM "Order" o ORDER BY o."vendorId", o."orderNumber";
