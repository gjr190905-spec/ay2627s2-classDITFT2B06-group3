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
DROP TABLE IF EXISTS "Something" CASCADE;
DROP TABLE IF EXISTS "Person" CASCADE;
DROP TABLE IF EXISTS "OrderItem" CASCADE;
DROP TABLE IF EXISTS "Order" CASCADE;
DROP TABLE IF EXISTS "PickupWindow" CASCADE;
DROP TABLE IF EXISTS "MenuItem" CASCADE;
DROP TABLE IF EXISTS "Stall" CASCADE;
DROP TABLE IF EXISTS "FoodCourt" CASCADE;

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

-- Indexes
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

--customer features tables--
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
CREATE TABLE "Stall" (
  "id" SERIAL NOT NULL,
  "foodCourtId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "pickupLocation" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Stall_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Stall_foodCourtId_fkey" FOREIGN KEY ("foodCourtId")
    REFERENCES "FoodCourt"("id") ON DELETE RESTRICT,
  CONSTRAINT "Stall_foodCourt_name_key" UNIQUE ("foodCourtId", "name")
);
CREATE UNIQUE INDEX "FoodCourt_name_lower_key" ON "FoodCourt" (lower("name"));

CREATE TABLE "MenuItem" (
  "id" SERIAL NOT NULL,
  "stallId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuItem_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Stall"("id"),
  CONSTRAINT "MenuItem_price_check" CHECK ("priceCents" >= 0)
);

CREATE TABLE "PickupWindow" (
  "id" SERIAL NOT NULL,
  "stallId" INTEGER NOT NULL,
  "startTime" TIMESTAMPTZ NOT NULL,
  "endTime" TIMESTAMPTZ NOT NULL,
  "maxOrders" INTEGER NOT NULL,
  "bookedCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PickupWindow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PickupWindow_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Stall"("id"),
  CONSTRAINT "PickupWindow_time_check" CHECK ("endTime" > "startTime"),
  CONSTRAINT "PickupWindow_capacity_check" CHECK ("maxOrders" > 0),
  CONSTRAINT "PickupWindow_booked_check" CHECK ("bookedCount" >= 0 AND "bookedCount" <= "maxOrders")
);

CREATE TABLE "Order" (
  "id" SERIAL NOT NULL,
  "customerId" INTEGER NOT NULL, --supposed to ref the user's id
  "stallId" INTEGER NOT NULL,
  "pickupWindowId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Confirmed',
  "totalCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "readyAt" TIMESTAMPTZ,
  "collectedAt" TIMESTAMPTZ,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Person"("id"),
  CONSTRAINT "Order_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Stall"("id"),
  CONSTRAINT "Order_pickupWindowId_fkey" FOREIGN KEY ("pickupWindowId") REFERENCES "PickupWindow"("id"),
  CONSTRAINT "Order_status_check" CHECK ("status" IN ('Confirmed', 'Preparing', 'Ready', 'Collected')),
  CONSTRAINT "Order_total_check" CHECK ("totalCents" >= 0)
);

CREATE TABLE "OrderItem" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "menuItemId" INTEGER NOT NULL,
  "itemName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "priceCentsAtOrder" INTEGER NOT NULL,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id"),
  CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id"),
  CONSTRAINT "OrderItem_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "OrderItem_price_check" CHECK ("priceCentsAtOrder" >= 0)
);
