-- =====================================================================
--  Campus Food Pickup App — Vendor-side database (PostgreSQL 13+)
--  Run in pgAdmin: open the Query Tool on an EMPTY database, paste, F5.
--  Re-runnable: drops and recreates everything in schema "pickup".
-- =====================================================================

SET client_min_messages = warning;       -- hide harmless "does not exist, skipping" notices
DROP SCHEMA IF EXISTS pickup CASCADE;
CREATE SCHEMA pickup;
SET search_path TO pickup;

CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive text for unique names/emails

-- ---------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------
-- Plan wording mapping:  accepted = confirmed,  completed = ready
CREATE TYPE order_status AS ENUM ('confirmed', 'preparing', 'ready', 'collected', 'cancelled');
CREATE TYPE app_theme    AS ENUM ('light', 'dark');
CREATE TYPE user_role    AS ENUM ('student', 'staff');

-- ---------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

-- =====================================================================
-- 1. VENDORS & STALLS  (Vendor home, Profile, Stall settings)
-- =====================================================================
CREATE TABLE vendors (
    vendor_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- unique ID per vendor
    email          CITEXT      NOT NULL UNIQUE,
    password_hash  TEXT        NOT NULL,                              -- store bcrypt/argon2 hash, never plain text
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stalls (
    stall_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vendor_id          BIGINT      NOT NULL UNIQUE REFERENCES vendors(vendor_id) ON DELETE CASCADE,
    stall_name         CITEXT      NOT NULL UNIQUE,      -- "Chicken Rice" blocks "chicken rice" too
    pickup_location    TEXT        NOT NULL,
    is_open            BOOLEAN     NOT NULL DEFAULT FALSE,   -- Vendor home open/close toggle
    profile_image_url  TEXT,                              -- exactly one profile picture (column = max 1)
    banner_image_url   TEXT,                              -- exactly one menu banner
    theme              app_theme   NOT NULL DEFAULT 'light',
    closing_time       TIME,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stall_name_not_blank CHECK (btrim(stall_name::text) <> '')
);
CREATE TRIGGER stalls_updated_at BEFORE UPDATE ON stalls
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Break times (a stall may have several breaks a day)
CREATE TABLE stall_breaks (
    break_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stall_id     BIGINT   NOT NULL REFERENCES stalls(stall_id) ON DELETE CASCADE,
    day_of_week  SMALLINT CHECK (day_of_week BETWEEN 1 AND 7),   -- 1=Mon … 7=Sun, NULL = every day
    start_time   TIME     NOT NULL,
    end_time     TIME     NOT NULL,
    CONSTRAINT break_time_order CHECK (end_time > start_time)
);

-- Dataset requirement: history of open/closed status changes
CREATE TABLE stall_status_log (
    log_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stall_id    BIGINT      NOT NULL REFERENCES stalls(stall_id) ON DELETE CASCADE,
    is_open     BOOLEAN     NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION trg_log_stall_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.is_open IS DISTINCT FROM OLD.is_open THEN
        INSERT INTO stall_status_log (stall_id, is_open) VALUES (NEW.stall_id, NEW.is_open);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stalls_status_log AFTER INSERT OR UPDATE OF is_open ON stalls
    FOR EACH ROW EXECUTE FUNCTION trg_log_stall_status();

-- =====================================================================
-- 2. MENU  (add / update / delete, sold out, quantity left, 1 image)
-- =====================================================================
CREATE TABLE menu_items (
    item_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stall_id       BIGINT        NOT NULL REFERENCES stalls(stall_id) ON DELETE CASCADE,
    name           TEXT          NOT NULL CHECK (btrim(name) <> ''),
    description    TEXT,
    price          NUMERIC(8,2)  NOT NULL CHECK (price >= 0),
    image_url      TEXT,                                  -- one image per item
    is_available   BOOLEAN       NOT NULL DEFAULT TRUE,   -- FALSE = "Sold out"
    quantity_left  INTEGER       CHECK (quantity_left >= 0),  -- NULL = not tracked / unlimited
    is_deleted     BOOLEAN       NOT NULL DEFAULT FALSE,  -- soft delete keeps past orders intact
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
-- No duplicate item names within one stall (ignores deleted items)
CREATE UNIQUE INDEX menu_items_unique_name
    ON menu_items (stall_id, lower(name)) WHERE NOT is_deleted;
CREATE INDEX menu_items_stall ON menu_items (stall_id) WHERE NOT is_deleted;

-- Quantity hits 0 -> automatically Sold out; restocking does NOT auto-reopen (vendor decides)
CREATE FUNCTION trg_menu_item_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.quantity_left = 0 THEN
        NEW.is_available := FALSE;
    END IF;
    IF NEW.is_deleted THEN
        NEW.is_available := FALSE;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER menu_items_sync BEFORE INSERT OR UPDATE ON menu_items
    FOR EACH ROW EXECUTE FUNCTION trg_menu_item_sync();

-- =====================================================================
-- 3. PICKUP WINDOWS & CAPACITY
-- =====================================================================
CREATE TABLE pickup_windows (
    window_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stall_id      BIGINT  NOT NULL REFERENCES stalls(stall_id) ON DELETE CASCADE,
    window_date   DATE    NOT NULL,
    start_time    TIME    NOT NULL,
    end_time      TIME    NOT NULL,
    max_orders    INTEGER NOT NULL CHECK (max_orders > 0),
    booked_count  INTEGER NOT NULL DEFAULT 0 CHECK (booked_count >= 0),   -- maintained by triggers
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT window_time_order   CHECK (end_time > start_time),
    -- Blocks vendors from reducing capacity below orders already booked
    CONSTRAINT capacity_not_below_booked CHECK (max_orders >= booked_count),
    CONSTRAINT window_unique UNIQUE (stall_id, window_date, start_time),
    UNIQUE (window_id, stall_id)        -- lets orders FK on (window, stall) pair
);
CREATE INDEX pickup_windows_stall_date ON pickup_windows (stall_id, window_date, start_time);

-- Friendlier error than the raw CHECK violation
CREATE FUNCTION trg_window_capacity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.max_orders < NEW.booked_count THEN
        RAISE EXCEPTION 'Cannot set capacity to % — % orders are already booked in this window',
            NEW.max_orders, NEW.booked_count
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER pickup_windows_capacity_guard BEFORE UPDATE OF max_orders ON pickup_windows
    FOR EACH ROW EXECUTE FUNCTION trg_window_capacity_guard();

-- =====================================================================
-- 4. CUSTOMERS (minimal — needed so orders have an owner)
-- =====================================================================
CREATE TABLE customers (
    customer_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name    TEXT        NOT NULL,
    email        CITEXT      NOT NULL UNIQUE,
    role         user_role   NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 5. ORDERS  (one order = one place in a window)
-- =====================================================================
CREATE SEQUENCE order_number_seq START 1001;

CREATE TABLE orders (
    order_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number  INTEGER      NOT NULL UNIQUE DEFAULT nextval('order_number_seq'),  -- shown to customer/vendor
    stall_id      BIGINT       NOT NULL REFERENCES stalls(stall_id),
    customer_id   BIGINT       NOT NULL REFERENCES customers(customer_id),
    window_id     BIGINT       NOT NULL,
    status        order_status NOT NULL DEFAULT 'confirmed',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    preparing_at  TIMESTAMPTZ,
    ready_at      TIMESTAMPTZ,     -- used to check "ready by end of booked window"
    collected_at  TIMESTAMPTZ,
    cancelled_at  TIMESTAMPTZ,
    -- window must belong to the same stall as the order
    FOREIGN KEY (window_id, stall_id) REFERENCES pickup_windows (window_id, stall_id)
);
CREATE INDEX orders_stall_status ON orders (stall_id, status);
CREATE INDEX orders_window      ON orders (window_id);

CREATE TABLE order_items (
    order_item_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id       BIGINT       NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    item_id        BIGINT       NOT NULL REFERENCES menu_items(item_id),
    item_name      TEXT         NOT NULL,          -- snapshot: menu edits don't rewrite history
    unit_price     NUMERIC(8,2) NOT NULL CHECK (unit_price >= 0),
    quantity       INTEGER      NOT NULL CHECK (quantity > 0),
    UNIQUE (order_id, item_id)
);

-- ---- 5a. Capacity booking: reserve a place when an order is created ----
CREATE FUNCTION trg_order_book_place() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'confirmed' THEN
        RAISE EXCEPTION 'New orders must start as confirmed';
    END IF;

    UPDATE pickup_windows
       SET booked_count = booked_count + 1
     WHERE window_id = NEW.window_id
       AND booked_count < max_orders;        -- row lock makes this race-safe

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pickup window % is full', NEW.window_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NOT (SELECT is_open FROM stalls WHERE stall_id = NEW.stall_id) THEN
        RAISE EXCEPTION 'Stall % is closed', NEW.stall_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER orders_book_place BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION trg_order_book_place();

-- ---- 5b. Status workflow: confirmed -> preparing -> ready -> collected ----
CREATE FUNCTION trg_order_status_flow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- A collected order is frozen: second collection can't alter the record
    IF OLD.status = 'collected' THEN
        RAISE EXCEPTION 'Order % was already collected at % and cannot be changed',
            OLD.order_number, OLD.collected_at;
    END IF;
    IF OLD.status = 'cancelled' THEN
        RAISE EXCEPTION 'Order % is cancelled and cannot be changed', OLD.order_number;
    END IF;

    -- Identity fields are fixed once placed
    IF NEW.stall_id <> OLD.stall_id OR NEW.window_id <> OLD.window_id
       OR NEW.order_number <> OLD.order_number OR NEW.customer_id <> OLD.customer_id THEN
        RAISE EXCEPTION 'Order stall/window/number/customer cannot be changed';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
               (OLD.status = 'confirmed' AND NEW.status IN ('preparing', 'cancelled'))
            OR (OLD.status = 'preparing' AND NEW.status IN ('ready', 'cancelled'))
            OR (OLD.status = 'ready'     AND NEW.status = 'collected')
        ) THEN
            RAISE EXCEPTION 'Invalid status change for order %: % -> %',
                OLD.order_number, OLD.status, NEW.status;
        END IF;

        -- Timestamps are set by the database, not the app
        CASE NEW.status
            WHEN 'preparing' THEN NEW.preparing_at := now();
            WHEN 'ready'     THEN NEW.ready_at     := now();
            WHEN 'collected' THEN NEW.collected_at := now();
            WHEN 'cancelled' THEN NEW.cancelled_at := now();
            ELSE NULL;
        END CASE;

        -- Cancelling frees the place in the window
        IF NEW.status = 'cancelled' THEN
            UPDATE pickup_windows SET booked_count = booked_count - 1
             WHERE window_id = OLD.window_id;
        END IF;
    ELSE
        -- No status change: don't allow tampering with the recorded times
        NEW.preparing_at := OLD.preparing_at;
        NEW.ready_at     := OLD.ready_at;
        NEW.collected_at := OLD.collected_at;
        NEW.cancelled_at := OLD.cancelled_at;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER orders_status_flow BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION trg_order_status_flow();

CREATE FUNCTION trg_order_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Orders cannot be deleted — cancel them instead';
END $$;
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION trg_order_no_delete();

-- ---- 5c. Checkout validation on each order line ----
CREATE FUNCTION trg_order_item_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_item        menu_items%ROWTYPE;
    v_order_stall BIGINT;
    v_status      order_status;
BEGIN
    SELECT stall_id, status INTO v_order_stall, v_status FROM orders WHERE order_id = NEW.order_id;
    IF v_status <> 'confirmed' THEN
        RAISE EXCEPTION 'Items can only be added while the order is confirmed';
    END IF;

    SELECT * INTO v_item FROM menu_items WHERE item_id = NEW.item_id FOR UPDATE;

    IF v_item.stall_id <> v_order_stall THEN
        RAISE EXCEPTION 'Item % does not belong to this stall', NEW.item_id;
    END IF;
    IF v_item.is_deleted OR NOT v_item.is_available THEN
        RAISE EXCEPTION '"%" is sold out', v_item.name;
    END IF;
    IF v_item.quantity_left IS NOT NULL THEN
        IF v_item.quantity_left < NEW.quantity THEN
            RAISE EXCEPTION 'Only % "%" left', v_item.quantity_left, v_item.name;
        END IF;
        UPDATE menu_items SET quantity_left = quantity_left - NEW.quantity
         WHERE item_id = NEW.item_id;      -- reaching 0 auto-marks Sold out
    END IF;

    NEW.item_name  := v_item.name;         -- snapshot name & price from menu
    NEW.unit_price := v_item.price;
    RETURN NEW;
END $$;
CREATE TRIGGER order_items_validate BEFORE INSERT ON order_items
    FOR EACH ROW EXECUTE FUNCTION trg_order_item_validate();

CREATE FUNCTION trg_order_item_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Order lines cannot be edited after checkout';
END $$;
CREATE TRIGGER order_items_lock BEFORE UPDATE ON order_items
    FOR EACH ROW EXECUTE FUNCTION trg_order_item_lock();

-- =====================================================================
-- 6. VIEWS FOR THE VENDOR SCREENS
-- =====================================================================

-- Menu + availability (vendor menu screen AND customer menu read the same rows)
CREATE VIEW v_stall_menu AS
SELECT m.stall_id, s.stall_name, m.item_id, m.name, m.description, m.price, m.image_url,
       m.quantity_left,
       CASE WHEN m.is_available THEN 'Available' ELSE 'Sold out' END AS availability
FROM menu_items m
JOIN stalls s USING (stall_id)
WHERE NOT m.is_deleted;

-- Capacity: booked vs remaining per window
CREATE VIEW v_window_capacity AS
SELECT w.window_id, w.stall_id, w.window_date, w.start_time, w.end_time,
       w.max_orders,
       w.booked_count                  AS places_booked,
       w.max_orders - w.booked_count   AS places_remaining
FROM pickup_windows w;

-- Preparation dashboard: orders grouped by window, earliest first
CREATE VIEW v_prep_dashboard AS
SELECT o.stall_id, w.window_id, w.window_date, w.start_time, w.end_time,
       o.order_id, o.order_number, o.status,
       oi.item_name, oi.quantity
FROM orders o
JOIN pickup_windows w ON w.window_id = o.window_id
JOIN order_items   oi ON oi.order_id = o.order_id
WHERE o.status IN ('confirmed', 'preparing', 'ready')
ORDER BY w.window_date, w.start_time, o.order_number, oi.item_name;

-- Collection screen: items + amount to collect
CREATE VIEW v_order_collection AS
SELECT o.stall_id, o.order_id, o.order_number, o.status,
       w.window_date, w.start_time, w.end_time,
       json_agg(json_build_object('item', oi.item_name, 'qty', oi.quantity,
                                  'unit_price', oi.unit_price) ORDER BY oi.item_name) AS items,
       SUM(oi.unit_price * oi.quantity)::NUMERIC(10,2) AS amount_to_collect
FROM orders o
JOIN pickup_windows w ON w.window_id = o.window_id
JOIN order_items   oi ON oi.order_id = o.order_id
GROUP BY o.order_id, w.window_id;

-- Team report: was each order ready by the end of its booked window?
-- (window times are local; timezone set to Asia/Singapore)
CREATE VIEW v_ready_on_time AS
SELECT o.stall_id, o.order_number, w.window_date, w.end_time, o.ready_at,
       (w.window_date + w.end_time) AT TIME ZONE 'Asia/Singapore' AS window_end_at,
       CASE
           WHEN o.ready_at IS NULL THEN NULL
           ELSE o.ready_at <= (w.window_date + w.end_time) AT TIME ZONE 'Asia/Singapore'
       END AS ready_on_time
FROM orders o
JOIN pickup_windows w ON w.window_id = o.window_id
WHERE o.status <> 'cancelled';

-- =====================================================================
-- 7. VENDOR ACTION FUNCTIONS (call these from the backend)
-- =====================================================================

-- Move an order forward: confirmed -> preparing -> ready. Only for the vendor's own stall.
CREATE FUNCTION advance_order(p_stall_id BIGINT, p_order_number INTEGER)
RETURNS order_status LANGUAGE plpgsql AS $$
DECLARE
    v_status order_status;
    v_next   order_status;
BEGIN
    SELECT status INTO v_status FROM orders
     WHERE order_number = p_order_number AND stall_id = p_stall_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found for this stall', p_order_number;
    END IF;

    v_next := CASE v_status WHEN 'confirmed' THEN 'preparing'::order_status
                            WHEN 'preparing' THEN 'ready'::order_status END;
    IF v_next IS NULL THEN
        RAISE EXCEPTION 'Order % is % — use collect_order for ready orders', p_order_number, v_status;
    END IF;

    UPDATE orders SET status = v_next
     WHERE order_number = p_order_number AND stall_id = p_stall_id;
    RETURN v_next;
END $$;

-- Mark collected: only Ready orders of that stall, only once.
CREATE FUNCTION collect_order(p_stall_id BIGINT, p_order_number INTEGER)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql AS $$
DECLARE
    v_status order_status;
    v_time   TIMESTAMPTZ;
BEGIN
    SELECT status INTO v_status FROM orders
     WHERE order_number = p_order_number AND stall_id = p_stall_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found for this stall', p_order_number;
    END IF;
    IF v_status <> 'ready' THEN
        RAISE EXCEPTION 'Order % is % — only ready orders can be collected', p_order_number, v_status;
    END IF;

    UPDATE orders SET status = 'collected'
     WHERE order_number = p_order_number AND stall_id = p_stall_id
    RETURNING collected_at INTO v_time;
    RETURN v_time;
END $$;

-- =====================================================================
-- 8. SEED DATA — preconfigured stall profiles with starter menus
--    (password_hash values are placeholders; replace with real hashes)
-- =====================================================================
INSERT INTO vendors (email, password_hash) VALUES
    ('chickenrice@campus.edu', '$2b$12$placeholderhashplaceholderhashplacehold'),
    ('noodles@campus.edu',     '$2b$12$placeholderhashplaceholderhashplacehold'),
    ('drinks@campus.edu',      '$2b$12$placeholderhashplaceholderhashplacehold');

INSERT INTO stalls (vendor_id, stall_name, pickup_location, is_open, closing_time) VALUES
    (1, 'Chicken Rice Stall', 'Food Court A, Counter 3', TRUE,  '20:00'),
    (2, 'Noodle House',       'Food Court A, Counter 5', TRUE,  '19:30'),
    (3, 'Drinks Corner',      'Food Court B, Counter 1', FALSE, '21:00');

INSERT INTO stall_breaks (stall_id, start_time, end_time) VALUES
    (1, '15:00', '15:30'),
    (2, '14:30', '15:00');

INSERT INTO menu_items (stall_id, name, description, price, quantity_left) VALUES
    (1, 'Roasted Chicken Rice', 'Roasted chicken with fragrant rice', 4.50, 50),
    (1, 'Steamed Chicken Rice', 'Classic Hainanese style',            4.50, 50),
    (1, 'Extra Egg',            'Braised egg',                        0.80, NULL),
    (2, 'Wanton Mee',           'Dry or soup',                        4.00, 40),
    (2, 'Fishball Noodles',     'With minced meat',                   3.80, NULL),
    (3, 'Iced Milo',            NULL,                                 1.80, NULL),
    (3, 'Lime Juice',           NULL,                                 1.50, 30);

INSERT INTO customers (full_name, email, role) VALUES
    ('Alex Tan',  'alex.tan@student.campus.edu', 'student'),
    ('Dr. Priya', 'priya@staff.campus.edu',      'staff');

INSERT INTO pickup_windows (stall_id, window_date, start_time, end_time, max_orders) VALUES
    (1, CURRENT_DATE, '11:30', '12:00', 10),
    (1, CURRENT_DATE, '12:00', '12:30', 10),
    (2, CURRENT_DATE, '12:00', '12:30', 8);