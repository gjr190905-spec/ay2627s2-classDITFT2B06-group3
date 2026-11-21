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

-- Create Users Table
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Stalls Table
CREATE TABLE stalls (
    stall_id SERIAL PRIMARY KEY,
    vendor_id INTEGER NOT NULL,
    stall_name VARCHAR(150) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,

    FOREIGN KEY (vendor_id) REFERENCES users(user_id)
);

-- Create Menu Items Table
CREATE TABLE menu_items (
    menu_item_id SERIAL PRIMARY KEY,
    stall_id INTEGER NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,

    FOREIGN KEY (stall_id) REFERENCES stalls(stall_id)
);

-- Create Pickup Windows Table
CREATE TABLE pickup_windows (
    window_id SERIAL PRIMARY KEY,
    stall_id INTEGER NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    capacity INTEGER NOT NULL,
    booked_count INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    FOREIGN KEY (stall_id) REFERENCES stalls(stall_id),

    CHECK (end_time > start_time),
    CHECK (capacity > 0),
    CHECK (booked_count >= 0),
    CHECK (booked_count <= capacity)
);

-- Create Orders Table
CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    stall_id INTEGER NOT NULL,
    pickup_window_id INTEGER NOT NULL,
    collection_reference VARCHAR(100) NOT NULL UNIQUE,
    total_amount NUMERIC(10,2) NOT NULL,
    order_status VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (customer_id) REFERENCES users(user_id),
    FOREIGN KEY (stall_id) REFERENCES stalls(stall_id),
    FOREIGN KEY (pickup_window_id) REFERENCES pickup_windows(window_id),

    CHECK (total_amount >= 0),
    CHECK (order_status IN (
        'CONFIRMED', 'PREPARING', 'READY',
        'COMPLETED', 'CANCELLED'
    ))
);

-- Create Order Items Table
CREATE TABLE order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER,
    item_name VARCHAR(150) NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    quantity INTEGER NOT NULL,
    subtotal NUMERIC(10,2) NOT NULL,

    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(menu_item_id)
);

-- Create Payments Table
CREATE TABLE payments (
    payment_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE,
    amount NUMERIC(10,2) NOT NULL,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    payment_method VARCHAR(50),
    transaction_reference VARCHAR(255),
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (order_id) REFERENCES orders(order_id),

    CHECK (amount >= 0),
    CHECK (payment_status IN (
        'PENDING', 'PAID', 'FAILED', 'REFUNDED'
    ))
);
  

-- Create Collections Table
CREATE TABLE collections (
    collection_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE,
    collected_by INTEGER NOT NULL,
    collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (collected_by) REFERENCES users(user_id)
);

-- Indexes
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

CREATE INDEX idx_pickup_windows_stall_time
ON pickup_windows(stall_id, start_time);
