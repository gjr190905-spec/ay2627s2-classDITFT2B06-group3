-- MAKAN LIAO / CA2 - FRESH TEAM DATABASE + PAYMENT/ORDER/PICKUP SAFEGUARDS
-- PostgreSQL 12+. Run ONLY in an EMPTY isolated database.
-- Do not run in the existing prototype or any shared database with data.
-- One transaction so an error rolls back the entire new schema.
-- Makan Liao shared branch schema for PostgreSQL 12+.
-- Run once in a fresh database. Existing branch data needs a separate migration.
-- Person.id = the customer or vendor owner account ID. Vendor.id = the stall ID.
-- Use the role-access account model to create accounts and store hashes.
-- Actual checkout orders use one row regardless of which branch reads them.
-- Manual/vendor-demo orders may omit customerId and pickupWindowId. They do not
-- reserve a slot or create an online payment record.
BEGIN;
SET LOCAL search_path TO public;

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
  "role" TEXT NOT NULL DEFAULT 'customer' CHECK ("role" IN ('customer', 'staff', 'vendor', 'admin')),
  "phone" VARCHAR(32),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonCredential" (
  "personId" INTEGER PRIMARY KEY REFERENCES "Person"("id") ON DELETE CASCADE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "FoodCourt" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "FoodCourt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FoodCourt_name_check"
    CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 100),
  CONSTRAINT "FoodCourt_location_check"
    CHECK ("location" = btrim("location") AND char_length("location") BETWEEN 1 AND 200)
);

-- Stalls created by the original vendor demo seed use a placeholder food court.
CREATE TABLE "Vendor" (
  "id" SERIAL NOT NULL,
  "email" TEXT,
  "foodCourtId" INTEGER NOT NULL REFERENCES "FoodCourt"("id") ON DELETE RESTRICT,
  "ownerUserId" INTEGER REFERENCES "Person"("id") ON DELETE RESTRICT,
  "pickupLocation" TEXT NOT NULL DEFAULT 'Stall counter',
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "stallName" TEXT NOT NULL,
  "logoUrl" TEXT,
  "isOpen" BOOLEAN NOT NULL DEFAULT FALSE,
  "statusUpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- Customer browsing uses the same rows as the vendor dashboard.
CREATE FUNCTION assign_default_foodcourt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."foodCourtId" IS NULL THEN
    INSERT INTO "FoodCourt" ("name", "location") VALUES ('Vendor Demo', 'Campus')
    ON CONFLICT (lower("name")) DO UPDATE SET "name" = "FoodCourt"."name"
    RETURNING "id" INTO NEW."foodCourtId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Vendor_default_foodCourt" BEFORE INSERT ON "Vendor"
FOR EACH ROW EXECUTE FUNCTION assign_default_foodcourt();

CREATE VIEW "Stall" AS
SELECT "id", "foodCourtId", "stallName" AS "name", "pickupLocation",
       "isActive", "isOpen"
FROM "Vendor";

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
  "stallId" INTEGER NOT NULL,
  "isAvailable" BOOLEAN NOT NULL,
  CONSTRAINT "MenuItem_stall_alias_check" CHECK ("stallId" = "vendorId"),
  CONSTRAINT "MenuItem_availability_alias_check"
    CHECK ("isAvailable" = (NOT "isSoldOut" AND "deletedAt" IS NULL)),
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

-- The customer seed writes stallId/isAvailable. The vendor model writes
-- vendorId/isSoldOut. Synchronize both spellings before constraints run.
CREATE FUNCTION sync_menu_aliases() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."isAvailable" IS NOT NULL THEN
      NEW."isSoldOut" := NOT NEW."isAvailable";
    END IF;
  ELSE
    IF NEW."stallId" IS DISTINCT FROM OLD."stallId"
      AND NEW."vendorId" IS NOT DISTINCT FROM OLD."vendorId" THEN
      NEW."vendorId" := NEW."stallId";
    ELSIF NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
      AND NEW."stallId" IS NOT DISTINCT FROM OLD."stallId" THEN
      NEW."stallId" := NEW."vendorId";
    END IF;
    IF NEW."isAvailable" IS DISTINCT FROM OLD."isAvailable"
      AND NEW."isSoldOut" IS NOT DISTINCT FROM OLD."isSoldOut" THEN
      NEW."isSoldOut" := NOT NEW."isAvailable";
    END IF;
  END IF;

  NEW."vendorId" := coalesce(NEW."vendorId", NEW."stallId");
  NEW."stallId" := coalesce(NEW."stallId", NEW."vendorId");
  NEW."isAvailable" := NOT NEW."isSoldOut" AND NEW."deletedAt" IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "MenuItem_sync_aliases" BEFORE INSERT OR UPDATE ON "MenuItem"
FOR EACH ROW EXECUTE FUNCTION sync_menu_aliases();

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

-- One saved cart per customer per stall. A cart item must come from that stall.
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_id_vendor_key" UNIQUE ("id", "vendorId");

CREATE TABLE "Cart" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL REFERENCES "Person"("id") ON DELETE CASCADE,
  "vendorId" INTEGER NOT NULL REFERENCES "Vendor"("id") ON DELETE CASCADE,
  UNIQUE ("customerId", "vendorId"),
  UNIQUE ("id", "vendorId")
);

CREATE TABLE "CartItem" (
  "cartId" INTEGER NOT NULL,
  "vendorId" INTEGER NOT NULL,
  "menuItemId" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN 1 AND 99),
  PRIMARY KEY ("cartId", "menuItemId"),
  FOREIGN KEY ("cartId", "vendorId") REFERENCES "Cart"("id", "vendorId") ON DELETE CASCADE,
  FOREIGN KEY ("menuItemId", "vendorId") REFERENCES "MenuItem"("id", "vendorId") ON DELETE CASCADE
);

CREATE TABLE "PickupWindow" (
  "id" SERIAL NOT NULL,
  "stallId" INTEGER NOT NULL,
  "startTime" TIMESTAMPTZ NOT NULL,
  "endTime" TIMESTAMPTZ NOT NULL,
  "maxOrders" INTEGER NOT NULL,
  "bookedCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE ("id", "stallId"),
  CONSTRAINT "PickupWindow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PickupWindow_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Vendor"("id"),
  CONSTRAINT "PickupWindow_time_check" CHECK ("endTime" > "startTime"),
  CONSTRAINT "PickupWindow_capacity_check" CHECK ("maxOrders" > 0),
  CONSTRAINT "PickupWindow_booked_check" CHECK ("bookedCount" >= 0 AND "bookedCount" <= "maxOrders")
);

CREATE TABLE "Order" (
  "id" SERIAL NOT NULL,
  "vendorId" INTEGER NOT NULL,
  "orderNumber" INTEGER NOT NULL,
  "customerId" INTEGER REFERENCES "Person"("id") ON DELETE RESTRICT,
  "stallId" INTEGER GENERATED ALWAYS AS ("vendorId") STORED,
  "pickupWindowId" INTEGER,
  "collectionReference" VARCHAR(100) UNIQUE
    CHECK (char_length(btrim("collectionReference")) > 0),
  "customerName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "pickupWindowStart" TIMESTAMPTZ NOT NULL,
  "pickupWindowEnd" TIMESTAMPTZ NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "preparingAt" TIMESTAMPTZ,
  "readyAt" TIMESTAMPTZ,
  "collectedAt" TIMESTAMPTZ,
  "cancelledAt" TIMESTAMPTZ,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "Vendor"("id") ON DELETE RESTRICT,
  CONSTRAINT "Order_pickupWindow_stall_fkey" FOREIGN KEY ("pickupWindowId", "vendorId")
    REFERENCES "PickupWindow"("id", "stallId") ON DELETE RESTRICT,
  CONSTRAINT "Order_customer_window_check" CHECK (("customerId" IS NULL) = ("pickupWindowId" IS NULL)),
  CONSTRAINT "Order_status_check" CHECK (
    "status" IN ('CONFIRMED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED')
  ),
  CONSTRAINT "Order_window_check" CHECK ("pickupWindowEnd" > "pickupWindowStart"),
  CONSTRAINT "Order_totalCents_check" CHECK ("totalCents" >= 0),
  CONSTRAINT "Order_customerName_check" CHECK (
    "customerName" IS NULL OR char_length("customerName") <= 60
  ),
  CONSTRAINT "Order_timestamps_check" CHECK (
    (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL))
    AND (
      ("status" = 'CONFIRMED' AND "preparingAt" IS NULL AND "readyAt" IS NULL
        AND "collectedAt" IS NULL)
      OR ("status" = 'PREPARING' AND "preparingAt" IS NOT NULL AND "readyAt" IS NULL
        AND "collectedAt" IS NULL)
      OR ("status" = 'READY' AND "preparingAt" IS NOT NULL AND "readyAt" IS NOT NULL
        AND "collectedAt" IS NULL)
      OR ("status" = 'COLLECTED' AND "preparingAt" IS NOT NULL AND "readyAt" IS NOT NULL
        AND "collectedAt" IS NOT NULL)
      OR ("status" = 'CANCELLED' AND "readyAt" IS NULL AND "collectedAt" IS NULL)
    )
  )
);

CREATE TABLE "OrderItem" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "menuItemId" INTEGER,
  "name" TEXT NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "itemName" TEXT GENERATED ALWAYS AS ("name") STORED,
  "priceCentsAtOrder" INTEGER GENERATED ALWAYS AS ("unitPriceCents") STORED,
  "subtotalCents" BIGINT GENERATED ALWAYS AS ("unitPriceCents"::BIGINT * "quantity") STORED,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId")
    REFERENCES "Order"("id") ON DELETE CASCADE,
  CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId")
    REFERENCES "MenuItem"("id") ON DELETE SET NULL,
  CONSTRAINT "OrderItem_unitPriceCents_check" CHECK ("unitPriceCents" >= 0),
  CONSTRAINT "OrderItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99)
);

-- New checkout orders start CONFIRMED. Cancellation is allowed before READY.
-- Historical orders can be imported directly with their full status timestamps.
CREATE FUNCTION "Order_enforce_status_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('COLLECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Order % is already %', OLD."orderNumber", OLD."status"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND NOT (
      (OLD."status" = 'CONFIRMED' AND NEW."status" IN ('PREPARING', 'CANCELLED'))
      OR (OLD."status" = 'PREPARING' AND NEW."status" IN ('READY', 'CANCELLED'))
      OR (OLD."status" = 'READY' AND NEW."status" = 'COLLECTED')
    ) THEN
    RAISE EXCEPTION 'Invalid order status change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_enforce_status_transition"
  BEFORE UPDATE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION "Order_enforce_status_transition"();

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

CREATE TABLE payments (
    payment_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE,
    amount NUMERIC(10,2) NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'PENDING',
    payment_method VARCHAR(50),
    transaction_reference VARCHAR(255),
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (order_id) REFERENCES "Order"("id"),

    CHECK (amount >= 0),
    CHECK (payment_status IN (
        'PENDING', 'PAID', 'FAILED', 'REFUNDED'
    ))
);

CREATE TABLE collections (
    collection_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE,
    collected_by INTEGER NOT NULL,
    collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (order_id) REFERENCES "Order"("id"),
    FOREIGN KEY (collected_by) REFERENCES "Person"("id")
);

CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");
CREATE UNIQUE INDEX "Person_email_ci_key" ON "Person"(lower("email"));
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");
CREATE INDEX "StoreClosure_vendorId_idx" ON "StoreClosure"("vendorId");
CREATE INDEX "MenuItem_vendorId_idx" ON "MenuItem"("vendorId") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Order_vendor_orderNumber_key" ON "Order"("vendorId", "orderNumber");
CREATE INDEX "Order_vendor_window_idx" ON "Order"("vendorId", "pickupWindowStart");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "VendorNotification_vendor_idx" ON "VendorNotification"("vendorId", "createdAt" DESC);
CREATE UNIQUE INDEX "Vendor_stallName_unique" ON "Vendor"(lower(btrim("stallName")));
CREATE UNIQUE INDEX "FoodCourt_name_lower_key" ON "FoodCourt" (lower("name"));
CREATE UNIQUE INDEX "MenuItem_vendor_name_unique"
  ON "MenuItem" ("vendorId", lower(btrim("name"))) WHERE "deletedAt" IS NULL;
CREATE INDEX "PickupWindow_stall_start_idx" ON "PickupWindow" ("stallId", "startTime");
CREATE INDEX "Order_customer_created_idx" ON "Order" ("customerId", "createdAt" DESC);

-- Read aliases share the same IDs and records as the quoted tables.
CREATE VIEW users AS
SELECT p."id" AS user_id, p."name" AS name, p."email" AS email,
       c."passwordHash" AS password_hash, p."role" AS role, c."createdAt" AS created_at
FROM "Person" p LEFT JOIN "PersonCredential" c ON c."personId" = p."id";

CREATE VIEW stalls AS
SELECT "id" AS stall_id, "ownerUserId" AS vendor_id, "stallName" AS stall_name,
       "description" AS description, ("isActive" AND "isOpen") AS is_active
FROM "Vendor";

CREATE VIEW menu_items AS
SELECT "id" AS menu_item_id, "vendorId" AS stall_id, "name" AS item_name,
       "description" AS description, ("priceCents" / 100.0)::numeric(10,2) AS price,
       "isAvailable" AS is_available
FROM "MenuItem" WHERE "deletedAt" IS NULL;

-- Simple aliases let PostgreSQL apply the existing conditional capacity update
-- directly to the same physical row that customer browsing reads.
CREATE VIEW pickup_windows AS
SELECT "id" AS window_id, "stallId" AS stall_id, "startTime" AS start_time,
       "endTime" AS end_time, "maxOrders" AS capacity, "bookedCount" AS booked_count,
       "isActive" AS is_active
FROM "PickupWindow";

CREATE VIEW orders AS
SELECT "id" AS order_id, "customerId" AS customer_id, "vendorId" AS stall_id,
       "pickupWindowId" AS pickup_window_id, "collectionReference" AS collection_reference,
       ("totalCents" / 100.0)::numeric(10,2) AS total_amount,
       CASE WHEN "status" = 'COLLECTED' THEN 'COMPLETED' ELSE "status" END AS order_status,
       "createdAt" AS created_at
FROM "Order";

ALTER VIEW orders ALTER COLUMN order_status SET DEFAULT 'CONFIRMED';

CREATE FUNCTION write_legacy_order() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  order_key integer;
  next_number integer;
  slot "PickupWindow"%ROWTYPE;
  target_status text;
BEGIN
  target_status := CASE WHEN NEW.order_status = 'COMPLETED' THEN 'COLLECTED'
                        ELSE NEW.order_status END;
  IF TG_OP = 'INSERT' THEN
    -- The legacy code already reserved capacity in its transaction.
    SELECT * INTO STRICT slot FROM "PickupWindow"
    WHERE "id" = NEW.pickup_window_id AND "stallId" = NEW.stall_id;

    -- Same lock and numbering rule as the vendor branch.
    PERFORM 1 FROM "Vendor"
    WHERE "id" = NEW.stall_id AND "isActive" AND "isOpen" FOR UPDATE;
    IF NOT FOUND OR NEW.customer_id IS NULL OR target_status IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION 'An open stall and a customer are required for a new confirmed order'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT coalesce(max("orderNumber"), 1000) + 1 INTO next_number
    FROM "Order" WHERE "vendorId" = NEW.stall_id;

    INSERT INTO "Order" ("vendorId", "orderNumber", "customerId", "pickupWindowId",
                         "customerName", "collectionReference", "totalCents", "status",
                         "pickupWindowStart", "pickupWindowEnd", "createdAt")
    VALUES (NEW.stall_id, next_number, NEW.customer_id, NEW.pickup_window_id,
            (SELECT left("name", 60) FROM "Person" WHERE "id" = NEW.customer_id),
            NEW.collection_reference, (NEW.total_amount * 100)::integer, target_status,
            slot."startTime", slot."endTime", coalesce(NEW.created_at, now()))
    RETURNING "id" INTO order_key;
  ELSE
    IF ROW(NEW.order_id, NEW.customer_id, NEW.stall_id, NEW.pickup_window_id,
           NEW.total_amount, NEW.created_at) IS DISTINCT FROM
       ROW(OLD.order_id, OLD.customer_id, OLD.stall_id, OLD.pickup_window_id,
           OLD.total_amount, OLD.created_at) THEN
      RAISE EXCEPTION 'Only order status and collection reference can be updated through orders';
    END IF;
    UPDATE "Order"
    SET "status" = target_status, "collectionReference" = NEW.collection_reference,
        "preparingAt" = CASE WHEN NEW.order_status <> OLD.order_status AND target_status = 'PREPARING'
                             THEN now() ELSE "preparingAt" END,
        "readyAt" = CASE WHEN NEW.order_status <> OLD.order_status AND target_status = 'READY'
                         THEN now() ELSE "readyAt" END,
        "collectedAt" = CASE WHEN NEW.order_status <> OLD.order_status AND target_status = 'COLLECTED'
                             THEN now() ELSE "collectedAt" END,
        "cancelledAt" = CASE WHEN NEW.order_status <> OLD.order_status AND target_status = 'CANCELLED'
                             THEN now() ELSE "cancelledAt" END
    WHERE "id" = OLD.order_id
      AND "status" = CASE WHEN OLD.order_status = 'COMPLETED' THEN 'COLLECTED' ELSE OLD.order_status END
      AND "collectionReference" IS NOT DISTINCT FROM OLD.collection_reference
    RETURNING "id" INTO order_key;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  SELECT * INTO NEW FROM orders WHERE order_id = order_key;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_legacy_write INSTEAD OF INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION write_legacy_order();

CREATE VIEW order_items AS
SELECT "id" AS order_item_id, "orderId" AS order_id, "menuItemId" AS menu_item_id,
       "name" AS item_name, ("unitPriceCents" / 100.0)::numeric(10,2) AS unit_price,
       "quantity" AS quantity, ("subtotalCents" / 100.0)::numeric(10,2) AS subtotal
FROM "OrderItem";

CREATE FUNCTION insert_legacy_order_item() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  stall_key integer;
  menu_row "MenuItem"%ROWTYPE;
  item_key integer;
BEGIN
  SELECT "vendorId" INTO STRICT stall_key FROM "Order" WHERE "id" = NEW.order_id;
  SELECT * INTO menu_row FROM "MenuItem"
  WHERE "id" = NEW.menu_item_id AND "vendorId" = stall_key FOR UPDATE;
  IF NOT FOUND OR NOT menu_row."isAvailable" OR NEW.quantity IS NULL
     OR NEW.quantity NOT BETWEEN 1 AND 99
     OR (menu_row."quantityLeft" IS NOT NULL AND menu_row."quantityLeft" < NEW.quantity)
     OR NEW.unit_price * 100 IS DISTINCT FROM menu_row."priceCents"
     OR NEW.subtotal IS DISTINCT FROM NEW.unit_price * NEW.quantity THEN
    RAISE EXCEPTION 'Menu stock, price or availability changed during checkout'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE "MenuItem"
  SET "quantityLeft" = "quantityLeft" - NEW.quantity,
      "isSoldOut" = "quantityLeft" = NEW.quantity, "updatedAt" = now()
  WHERE "id" = NEW.menu_item_id AND "quantityLeft" IS NOT NULL;

  INSERT INTO "OrderItem" ("orderId", "menuItemId", "name", "unitPriceCents", "quantity")
  VALUES (NEW.order_id, NEW.menu_item_id, menu_row."name", menu_row."priceCents", NEW.quantity)
  RETURNING "id" INTO item_key;
  SELECT * INTO NEW FROM order_items WHERE order_item_id = item_key;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_items_legacy_insert INSTEAD OF INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION insert_legacy_order_item();


-- --- reviewed compatibility and prototype-feature extension ---
DO $$
BEGIN
  IF to_regclass('public."Person"') IS NULL
     OR to_regclass('public."PersonCredential"') IS NULL
     OR to_regclass('public."Vendor"') IS NULL
     OR to_regclass('public."MenuItem"') IS NULL
     OR to_regclass('public."Order"') IS NULL
     OR to_regclass('public."CartItem"') IS NULL THEN
    RAISE EXCEPTION 'Expected MAIN Person/Vendor/Order schema is missing; do NOT apply this to the prototype database';
  END IF;
  IF (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.users'::regclass) <> 'v' THEN
    RAISE EXCEPTION 'Expected users to be a VIEW in main; found another relation type. Stop and reconcile the databases';
  END IF;
END;
$$;

-- Store one identity: Person is canonical; no competing physical users table.
-- Dates are real timestamptz values; ISO 8601 strings from Node/Postgres are accepted.
CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  user_id INTEGER NOT NULL REFERENCES "Person"("id") ON DELETE CASCADE,
  csrf_token TEXT NOT NULL CHECK (char_length(csrf_token) >= 32),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Fail rather than silently reuse a different prototype/earlier-experiment session shape.
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'sessions'
     AND column_name = 'expires_at' AND data_type = 'timestamp with time zone'
 ) OR NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'sessions'
     AND column_name = 'user_id' AND data_type = 'integer'
 ) THEN
   RAISE EXCEPTION 'Existing sessions schema differs (expected TIMESTAMPTZ expires_at and INTEGER user_id); plan explicit migration';
 END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS sessions_user_expires_idx ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

-- Optional food customisation, with confirmed options distinguished from demo options.
CREATE TABLE IF NOT EXISTS menu_addons (
  id BIGSERIAL PRIMARY KEY,
  menu_item_id INTEGER NOT NULL REFERENCES "MenuItem"("id") ON DELETE CASCADE,
  option_key TEXT NOT NULL CHECK (char_length(btrim(option_key)) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  extra_cents INTEGER NOT NULL DEFAULT 0 CHECK (extra_cents BETWEEN 0 AND 99999),
  is_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (is_confirmed IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (menu_item_id, option_key)
);
CREATE INDEX IF NOT EXISTS menu_addons_item_order_idx ON menu_addons(menu_item_id, display_order);

-- Prototype-facing display metadata: preserve physical source-of-truth entity IDs.
ALTER TABLE "FoodCourt" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;
ALTER TABLE "FoodCourt" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "FoodCourt" ADD COLUMN IF NOT EXISTS "openingTime" TIME;
ALTER TABLE "FoodCourt" ADD COLUMN IF NOT EXISTS "closingTime" TIME;
ALTER TABLE "FoodCourt" ADD COLUMN IF NOT EXISTS "imagePath" TEXT;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "cuisine" TEXT;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "accent" TEXT;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "capacityPerSlot" INTEGER;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "imagePath" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN IF NOT EXISTS "imagePath" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "selections" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Variant lines require explicit checkout integration; do not double-count CartItem.quantity.
CREATE TABLE IF NOT EXISTS "CartItemVariant" (
  "cartId" INTEGER NOT NULL,
  "menuItemId" INTEGER NOT NULL,
  "variantKey" TEXT NOT NULL CHECK (char_length(btrim("variantKey")) BETWEEN 1 AND 100),
  "selections" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "unitPriceCents" INTEGER NOT NULL CHECK ("unitPriceCents" >= 0),
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN 1 AND 99),
  PRIMARY KEY ("cartId", "menuItemId", "variantKey"),
  FOREIGN KEY ("cartId", "menuItemId") REFERENCES "CartItem"("cartId", "menuItemId") ON DELETE CASCADE
);

-- Checkout handover / QR scan: one code per order; app must verify scanner permissions.
CREATE TABLE IF NOT EXISTS pickup_passes (
  order_id INTEGER PRIMARY KEY REFERENCES "Order"("id") ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 8 AND 200),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_at TIMESTAMPTZ,
  scanned_by INTEGER REFERENCES "Person"("id") ON DELETE SET NULL,
  CHECK (scanned_at IS NULL OR scanned_at >= issued_at)
);

-- Notifications are addressed to the specific customer, not a global banner.
CREATE TABLE IF NOT EXISTS "CustomerNotification" (
  "id" BIGSERIAL PRIMARY KEY,
  "personId" INTEGER NOT NULL REFERENCES "Person"("id") ON DELETE CASCADE,
  "orderId" INTEGER REFERENCES "Order"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL CHECK ("type" IN ('ORDER_READY','ORDER_CANCELLED','SYSTEM')),
  "message" TEXT NOT NULL CHECK (char_length(btrim("message")) BETWEEN 1 AND 240),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "readAt" TIMESTAMPTZ,
  UNIQUE ("personId", "orderId", "type")
);
CREATE INDEX IF NOT EXISTS customer_notification_unread_idx
  ON "CustomerNotification" ("personId", "createdAt" DESC) WHERE "readAt" IS NULL;

-- Minimal opt-in device delivery queue. Only a verified session may register its endpoint.
CREATE TABLE IF NOT EXISTS pickup_devices (
  endpoint TEXT PRIMARY KEY CHECK (char_length(endpoint) BETWEEN 12 AND 2048),
  session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pickup_devices_session_idx ON pickup_devices(session_id);
CREATE TABLE IF NOT EXISTS pickup_deliveries (
  order_id INTEGER NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  endpoint TEXT NOT NULL REFERENCES pickup_devices(endpoint) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (order_id, endpoint)
);

-- Optional app metadata, NOT a user or authentication store.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Keep all existing columns in their original order so CREATE OR REPLACE VIEW succeeds.
-- Appended fields match SCRUM-12's user lookups (not a second account store).
CREATE OR REPLACE VIEW users AS
SELECT p."id" AS user_id,
       p."name" AS name,
       p."email" AS email,
       c."passwordHash" AS password_hash,
       p."role" AS role,
       c."createdAt" AS created_at,
       p."id" AS id,
       p."name" AS display_name,
       p."phone" AS phone,
       (SELECT v."id" FROM "Vendor" v WHERE v."ownerUserId" = p."id"
         ORDER BY v."id" LIMIT 1) AS stall_id,
       CASE WHEN p."isActive" THEN 1 ELSE 0 END AS is_active
FROM "Person" p LEFT JOIN "PersonCredential" c ON c."personId" = p."id";

-- Support the SCRUM-12 INSERT/UPDATE contracts through a protected compatibility view.
-- IMPORTANT: The application must authorize profile edits/role changes. Never expose raw SQL.
CREATE OR REPLACE FUNCTION app_users_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_user_id INTEGER;
  v_name TEXT;
  v_role TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_name := btrim(coalesce(NEW.display_name, NEW.name, ''));
    v_role := coalesce(NEW.role, 'customer');
    IF char_length(v_name) NOT BETWEEN 1 AND 100 OR coalesce(btrim(NEW.email), '') = ''
       OR coalesce(NEW.password_hash, '') = ''
       OR v_role NOT IN ('customer','vendor','staff','admin')
       OR coalesce(NEW.is_active,1) NOT IN (0,1) THEN
      RAISE EXCEPTION 'Invalid account insert' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO "Person" ("name", "email", "phone", "role", "isActive")
    VALUES (v_name, lower(btrim(NEW.email)), NEW.phone, v_role, coalesce(NEW.is_active,1) = 1)
    RETURNING "id" INTO v_user_id;
    INSERT INTO "PersonCredential" ("personId", "passwordHash", "createdAt")
    VALUES (v_user_id, NEW.password_hash, coalesce(NEW.created_at, now()));
    IF NEW.stall_id IS NOT NULL THEN
      IF v_role <> 'vendor' THEN
        RAISE EXCEPTION 'Only vendor accounts may be assigned a stall' USING ERRCODE = 'check_violation';
      END IF;
      UPDATE "Vendor" SET "ownerUserId" = v_user_id
      WHERE "id" = NEW.stall_id AND "ownerUserId" IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stall not found or already assigned' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_user_id := OLD.id;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Cannot modify account identity or creation date' USING ERRCODE = 'check_violation';
    END IF;
    v_name := btrim(coalesce(NEW.display_name, NEW.name, ''));
    IF char_length(v_name) NOT BETWEEN 1 AND 100 OR coalesce(btrim(NEW.email),'') = ''
       OR NEW.role NOT IN ('customer','vendor','staff','admin')
       OR NEW.is_active NOT IN (0,1) THEN
      RAISE EXCEPTION 'Invalid account update' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE "Person" SET "name" = v_name, "email" = lower(btrim(NEW.email)),
      "phone" = NEW.phone, "role" = NEW.role, "isActive" = (NEW.is_active = 1)
    WHERE "id" = v_user_id;
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
      IF coalesce(NEW.password_hash,'') = '' THEN
        RAISE EXCEPTION 'Password hash cannot be empty' USING ERRCODE = 'check_violation';
      END IF;
      INSERT INTO "PersonCredential" ("personId", "passwordHash") VALUES (v_user_id, NEW.password_hash)
      ON CONFLICT ("personId") DO UPDATE SET "passwordHash" = excluded."passwordHash";
    END IF;
    IF NEW.stall_id IS DISTINCT FROM OLD.stall_id THEN
      IF NEW.stall_id IS NOT NULL AND NEW.role <> 'vendor' THEN
        RAISE EXCEPTION 'Only vendor accounts may own stalls' USING ERRCODE = 'check_violation';
      END IF;
      UPDATE "Vendor" SET "ownerUserId" = NULL
        WHERE "id" = OLD.stall_id AND "ownerUserId" = v_user_id;
      IF NEW.stall_id IS NOT NULL THEN
        UPDATE "Vendor" SET "ownerUserId" = v_user_id
          WHERE "id" = NEW.stall_id AND "ownerUserId" IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Stall not found or already assigned' USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Delete via users view is disabled; deactivate the account instead'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO NEW FROM users WHERE id = v_user_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS users_compat_write ON users;
CREATE TRIGGER users_compat_write INSTEAD OF INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app_users_write();

-- Keep the original five stall-view fields unchanged, and append authentication aliases.
CREATE OR REPLACE VIEW stalls AS
SELECT v."id" AS stall_id, v."ownerUserId" AS vendor_id,
       v."stallName" AS stall_name, v."description" AS description,
       (v."isActive" AND v."isOpen") AS is_active,
       v."id" AS id, v."stallName" AS name,
       v."foodCourtId" AS food_court_id, v."cuisine" AS cuisine,
       v."accent" AS accent, v."capacityPerSlot" AS capacity_per_slot,
       v."isOpen" AS is_open, v."imagePath" AS image_path
FROM "Vendor" v;

-- Prevent a direct OrderItem insert from referencing a menu item belonging to a different stall.
CREATE OR REPLACE FUNCTION ensure_order_item_vendor() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_order_vendor INTEGER; v_item_vendor INTEGER;
BEGIN
  IF NEW."menuItemId" IS NOT NULL THEN
    SELECT "vendorId" INTO v_order_vendor FROM "Order" WHERE "id" = NEW."orderId";
    SELECT "vendorId" INTO v_item_vendor FROM "MenuItem" WHERE "id" = NEW."menuItemId";
    IF v_order_vendor IS DISTINCT FROM v_item_vendor THEN
      RAISE EXCEPTION 'OrderItem menu item must belong to the same stall as the order'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS order_item_vendor_check ON "OrderItem";
CREATE TRIGGER order_item_vendor_check BEFORE INSERT OR UPDATE OF "menuItemId", "orderId" ON "OrderItem"
FOR EACH ROW EXECUTE FUNCTION ensure_order_item_vendor();

-- Personal bell notifications (not full-width banners). The app still owns dismissal/read APIs.
CREATE OR REPLACE FUNCTION notify_customer_order_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."customerId" IS NOT NULL AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NEW."status" = 'READY' THEN
      INSERT INTO "CustomerNotification" ("personId", "orderId", "type", "message")
      VALUES (NEW."customerId", NEW."id", 'ORDER_READY', 'Your order is ready for collection.')
      ON CONFLICT ("personId", "orderId", "type") DO NOTHING;
    ELSIF NEW."status" = 'CANCELLED' THEN
      INSERT INTO "CustomerNotification" ("personId", "orderId", "type", "message")
      VALUES (NEW."customerId", NEW."id", 'ORDER_CANCELLED', 'Your order was cancelled.')
      ON CONFLICT ("personId", "orderId", "type") DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS order_customer_notification ON "Order";
CREATE TRIGGER order_customer_notification AFTER UPDATE OF "status" ON "Order"
FOR EACH ROW EXECUTE FUNCTION notify_customer_order_status();

-- Queue READY handovers to current opt-in pickup devices (for asynchronous delivery workers).
CREATE OR REPLACE FUNCTION queue_customer_pickup() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."customerId" IS NOT NULL THEN
    INSERT INTO pickup_deliveries(order_id, endpoint)
    SELECT NEW."id", d.endpoint FROM pickup_devices d
    JOIN sessions s ON s.id = d.session_id
    WHERE s.user_id = NEW."customerId" AND s.expires_at > now()
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "Order_queue_customer_pickup" ON "Order";
DROP TRIGGER IF EXISTS order_queue_customer_pickup ON "Order";
CREATE TRIGGER order_queue_customer_pickup AFTER UPDATE OF "status" ON "Order"
FOR EACH ROW WHEN (NEW."status" = 'READY' AND NEW."status" IS DISTINCT FROM OLD."status")
EXECUTE FUNCTION queue_customer_pickup();



-- === ADDITIONAL TESTED-CHECK SAFEGUARDS: PAYMENTS, CHECKOUT, COLLECTION ===
DO $$
BEGIN
  IF to_regclass('public."Order"') IS NULL OR
     to_regclass('public."OrderItem"') IS NULL OR
     to_regclass('public."Vendor"') IS NULL OR
     to_regclass('public."Person"') IS NULL OR
     to_regclass('public.payments') IS NULL OR
     to_regclass('public.pickup_passes') IS NULL OR
     to_regclass('public.collections') IS NULL THEN
    RAISE EXCEPTION 'Unsupported database schema; expected reviewed Makan Liao tables';
  END IF;
END;
$$;

-- Protect existing data when adding new invariants. Never silently change order money.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM payments p JOIN "Order" o ON o."id" = p.order_id
    WHERE p.amount * 100 <> o."totalCents"
  ) THEN
    RAISE EXCEPTION 'Existing payment/order totals differ; reconcile before applying safeguards';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Order" o
    LEFT JOIN (
      SELECT "orderId", count(*) AS n, coalesce(sum("subtotalCents"),0)::bigint AS cents
      FROM "OrderItem" GROUP BY "orderId"
    ) li ON li."orderId" = o."id"
    WHERE o."customerId" IS NOT NULL AND
      (coalesce(li.n,0) = 0 OR coalesce(li.cents,0) <> o."totalCents")
  ) THEN
    RAISE EXCEPTION 'Existing customer orders lack items or line totals disagree; reconcile before applying safeguards';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pickup_passes pp
    JOIN "Order" o ON o."id" = pp.order_id
    JOIN "Vendor" v ON v."id" = o."vendorId"
    LEFT JOIN "Person" p ON p."id" = pp.scanned_by
    WHERE (pp.scanned_at IS NULL) <> (pp.scanned_by IS NULL)
      OR (pp.scanned_by IS NOT NULL AND
        (pp.scanned_by IS DISTINCT FROM v."ownerUserId" OR
         p."role" IS DISTINCT FROM 'vendor' OR p."isActive" IS DISTINCT FROM TRUE))
  ) THEN
    RAISE EXCEPTION 'Existing pickup scan audit records lack a valid vendor owner; reconcile before applying safeguards';
  END IF;
  IF EXISTS (
    SELECT 1 FROM collections c
    JOIN "Order" o ON o."id" = c.order_id
    JOIN "Vendor" v ON v."id" = o."vendorId"
    LEFT JOIN "Person" p ON p."id" = c.collected_by
    WHERE c.collected_by IS DISTINCT FROM v."ownerUserId"
       OR o."status" <> 'COLLECTED'
       OR p."role" IS DISTINCT FROM 'vendor'
       OR p."isActive" IS DISTINCT FROM TRUE
  ) THEN
    RAISE EXCEPTION 'Existing collection records lack a valid vendor owner/collected order; reconcile first';
  END IF;
END;
$$;

-- 1. Payment amount (decimal currency units) must equal integer order cents.
-- Locking the order row serializes payment writes with order total changes.
CREATE OR REPLACE FUNCTION public.makan_check_payment_total() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected_cents integer;
BEGIN
  SELECT o."totalCents" INTO expected_cents
  FROM "Order" o WHERE o."id" = NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment requires an existing order'
      USING ERRCODE = '23503';
  END IF;
  IF NEW.amount * 100 <> expected_cents THEN
    RAISE EXCEPTION 'Payment amount % does not match order total % cents', NEW.amount, expected_cents
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS makan_payment_total_guard ON public.payments;
CREATE TRIGGER makan_payment_total_guard
BEFORE INSERT OR UPDATE OF order_id, amount ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.makan_check_payment_total();

-- Also block later changing an order total away from an existing payment.
CREATE OR REPLACE FUNCTION public.makan_guard_order_total() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM payments p WHERE p.order_id = NEW."id" AND p.amount * 100 <> NEW."totalCents"
  ) THEN
    RAISE EXCEPTION 'Order total cannot differ from its recorded payment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS makan_order_total_guard ON public."Order";
CREATE TRIGGER makan_order_total_guard
BEFORE UPDATE OF "totalCents" ON public."Order"
FOR EACH ROW EXECUTE FUNCTION public.makan_guard_order_total();

-- 2. Every customer checkout order requires >= 1 item and the exact sum of
-- generated OrderItem.subtotalCents. Manual vendor-demo orders (customerId NULL)
-- are deliberately exempt. Checks are deferred to transaction commit so legacy
-- checkout can INSERT order first, then its lines, atomically.
CREATE OR REPLACE FUNCTION public.makan_assert_customer_order_lines(p_order_id integer)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  expected_cents integer;
  customer_key integer;
  item_count bigint;
  item_cents bigint;
BEGIN
  IF p_order_id IS NULL THEN RETURN; END IF;
  SELECT o."totalCents", o."customerId" INTO expected_cents, customer_key
  FROM "Order" o WHERE o."id" = p_order_id FOR UPDATE;
  IF NOT FOUND OR customer_key IS NULL THEN RETURN; END IF;
  SELECT count(*), coalesce(sum(li."subtotalCents"),0)::bigint
  INTO item_count, item_cents FROM "OrderItem" li WHERE li."orderId" = p_order_id;
  IF item_count = 0 OR item_cents <> expected_cents THEN
    RAISE EXCEPTION 'Customer order % requires items totalling % cents; found % items totalling % cents',
      p_order_id, expected_cents, item_count, item_cents USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.makan_check_order_lines_from_order() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM makan_assert_customer_order_lines(NEW."id");
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS makan_order_lines_deferred ON public."Order";
CREATE CONSTRAINT TRIGGER makan_order_lines_deferred
AFTER INSERT OR UPDATE ON public."Order"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.makan_check_order_lines_from_order();

CREATE OR REPLACE FUNCTION public.makan_check_order_lines_from_item() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM makan_assert_customer_order_lines(NEW."orderId");
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM makan_assert_customer_order_lines(OLD."orderId");
  ELSE
    PERFORM makan_assert_customer_order_lines(OLD."orderId");
    IF NEW."orderId" IS DISTINCT FROM OLD."orderId" THEN
      PERFORM makan_assert_customer_order_lines(NEW."orderId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS makan_order_item_lines_deferred ON public."OrderItem";
CREATE CONSTRAINT TRIGGER makan_order_item_lines_deferred
AFTER INSERT OR UPDATE OR DELETE ON public."OrderItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.makan_check_order_lines_from_item();

-- 3. Only the active, designated vendor owner may scan a pickup pass.
-- Staff and admin delegation require an explicit stall-assignment model and API
-- checks; they are intentionally NOT inferred from a generic role value.
CREATE OR REPLACE FUNCTION public.makan_authorize_pickup_scan() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  owner_id integer;
  order_status text;
  scanner_role text;
  scanner_active boolean;
BEGIN
  IF (NEW.scanned_at IS NULL) <> (NEW.scanned_by IS NULL) THEN
    RAISE EXCEPTION 'Pickup scan time and scanner identity must both be supplied'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'A pickup pass cannot be moved to another order'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.scanned_at IS NOT NULL AND
      (OLD.scanned_at IS DISTINCT FROM NEW.scanned_at OR
       OLD.scanned_by IS DISTINCT FROM NEW.scanned_by) THEN
    RAISE EXCEPTION 'A pickup scan cannot be cleared or reassigned'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.scanned_at IS NOT NULL THEN
    SELECT v."ownerUserId", o."status", p."role", p."isActive"
      INTO owner_id, order_status, scanner_role, scanner_active
    FROM "Order" o JOIN "Vendor" v ON v."id" = o."vendorId"
    LEFT JOIN "Person" p ON p."id" = NEW.scanned_by
    WHERE o."id" = NEW.order_id FOR UPDATE OF o;
    IF NOT FOUND OR owner_id IS DISTINCT FROM NEW.scanned_by OR
       scanner_role IS DISTINCT FROM 'vendor' OR scanner_active IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Pickup scanner is not the active owner of this stall'
        USING ERRCODE = '23514';
    END IF;
    IF order_status NOT IN ('READY','COLLECTED') THEN
      RAISE EXCEPTION 'Cannot scan an order that is not ready for collection'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS makan_pickup_scan_guard ON public.pickup_passes;
CREATE TRIGGER makan_pickup_scan_guard
BEFORE INSERT OR UPDATE OF scanned_at, scanned_by, order_id ON public.pickup_passes
FOR EACH ROW EXECUTE FUNCTION public.makan_authorize_pickup_scan();

-- Collection records are also protected, not merely the QR scan audit column.
CREATE OR REPLACE FUNCTION public.makan_authorize_collection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  owner_id integer;
  order_status text;
  collector_role text;
  collector_active boolean;
BEGIN
  SELECT v."ownerUserId", o."status", p."role", p."isActive"
  INTO owner_id, order_status, collector_role, collector_active
  FROM "Order" o JOIN "Vendor" v ON v."id" = o."vendorId"
  LEFT JOIN "Person" p ON p."id" = NEW.collected_by
  WHERE o."id" = NEW.order_id FOR UPDATE OF o;
  IF NOT FOUND OR owner_id IS DISTINCT FROM NEW.collected_by OR
     collector_role IS DISTINCT FROM 'vendor' OR collector_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Collector is not the active owner of this stall'
      USING ERRCODE = '23514';
  END IF;
  IF order_status <> 'COLLECTED' THEN
    RAISE EXCEPTION 'Collection records require COLLECTED order status'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS makan_collection_guard ON public.collections;
CREATE TRIGGER makan_collection_guard
BEFORE INSERT OR UPDATE OF order_id, collected_by ON public.collections
FOR EACH ROW EXECUTE FUNCTION public.makan_authorize_collection();

COMMIT;
