SELECT current_database() AS database_name;

SELECT tablename
FROM pg_tables
WHERE schemaname = 'makan_liao'
ORDER BY tablename;

BEGIN;

DO $$
DECLARE
    first_court integer;
    first_stall integer;
    second_stall integer;
    customer_id integer;
    test_cart integer;
    first_item integer;
    second_item integer;
    suffix text := txid_current()::text;
BEGIN
    IF current_database() <> 'makan_liao_ca2_dev' THEN
        RAISE EXCEPTION 'Open Query Tool in makan_liao_ca2_dev';
    END IF;

    IF (SELECT count(*) FROM pg_tables
        WHERE schemaname = 'makan_liao'
          AND tablename IN ('users', 'sessions', 'food_courts', 'stalls',
              'menu_items', 'carts', 'cart_items', 'orders', 'order_items',
              'order_status_events', 'admin_audit_logs')) <> 11 THEN
        RAISE EXCEPTION 'Expected all 11 CA2 tables';
    END IF;

    IF (SELECT count(*) FROM makan_liao._prisma_migrations
        WHERE migration_name IN ('20261118130000_init_starter', '20261118140000_add_ca2_canteen')
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL) <> 2 THEN
        RAISE EXCEPTION 'Expected both migrations to be applied';
    END IF;

    IF (SELECT count(*) FROM pg_constraint
        WHERE connamespace = 'makan_liao'::regnamespace AND contype = 'c' AND convalidated
          AND conname IN ('users_vendor_stall_check', 'menu_items_price_check',
                          'cart_items_quantity_check', 'orders_total_check', 'order_items_values_check')) <> 5 THEN
        RAISE EXCEPTION 'Expected all five CA2 check constraints';
    END IF;

    INSERT INTO makan_liao.food_courts (code, name, updated_at)
    VALUES ('TEST-' || suffix, 'Verification Court', now()) RETURNING id INTO first_court;

    INSERT INTO makan_liao.stalls (food_court_id, name, pickup_location, updated_at)
    VALUES (first_court, 'Stall A', 'Counter A', now()) RETURNING id INTO first_stall;
    INSERT INTO makan_liao.stalls (food_court_id, name, pickup_location, updated_at)
    VALUES (first_court, 'Stall B', 'Counter B', now()) RETURNING id INTO second_stall;

    INSERT INTO makan_liao.users (display_name, email, password_hash, updated_at)
    VALUES ('Verification Customer', 'verify-' || suffix || '@example.invalid',
            'rollback-only-placeholder', now()) RETURNING id INTO customer_id;

    INSERT INTO makan_liao.carts (user_id, stall_id, updated_at)
    VALUES (customer_id, first_stall, now()) RETURNING id INTO test_cart;

    INSERT INTO makan_liao.menu_items (stall_id, name, price_cents, updated_at)
    VALUES (first_stall, 'Set A', 450, now()) RETURNING id INTO first_item;
    INSERT INTO makan_liao.menu_items (stall_id, name, price_cents, updated_at)
    VALUES (second_stall, 'Set B', 500, now()) RETURNING id INTO second_item;

    INSERT INTO makan_liao.cart_items (cart_id, stall_id, menu_item_id, quantity)
    VALUES (test_cart, first_stall, first_item, 1);

    BEGIN
        UPDATE makan_liao.cart_items SET quantity = 0 WHERE cart_id = test_cart;
        RAISE EXCEPTION 'Quantity zero was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO makan_liao.cart_items (cart_id, stall_id, menu_item_id, quantity)
        VALUES (test_cart, first_stall, second_item, 1);
        RAISE EXCEPTION 'Cross-stall item was accepted';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    RAISE NOTICE 'CA2 database smoke test passed.';
END
$$;

ROLLBACK;

