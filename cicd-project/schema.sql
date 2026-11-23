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

COMMIT;
