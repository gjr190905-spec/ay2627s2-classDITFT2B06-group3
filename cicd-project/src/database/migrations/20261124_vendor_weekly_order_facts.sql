-- Migration: vendor weekly order facts compatibility (PostgreSQL 13+)
-- Safe, re-runnable, NO DROP TABLE, NO user/order data mutation.
-- Run on development DB first and review with team before shared DB rollout.
-- This view is based on the EXISTING authoritative status and money columns.
-- Do not run vendor_schema.sql: it DROP SCHEMA ... CASCADE.
DO $ml_vendor_weekly$
DECLARE
  s text := current_schema();
  status_col text;
  amount_expr text;
  order_join text := '';
  view_sql text;
  bad_completed bigint;
  source_status text;
BEGIN
  IF to_regclass(format('%I.orders',s)) IS NULL THEN
    RAISE EXCEPTION 'Missing %.orders; database schema may be wrong', s;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname=s AND c.relname='orders' AND c.relkind IN ('r','p')) THEN
    RAISE EXCEPTION '%.orders must be a physical table', s;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema=s AND table_name='orders' AND column_name='stall_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema=s AND table_name='orders' AND column_name='created_at') THEN
    RAISE EXCEPTION 'orders must have stall_id and created_at';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema=s AND table_name='orders' AND column_name='status') THEN
    status_col := 'status';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema=s AND table_name='orders' AND column_name='order_status') THEN
    status_col := 'order_status';
  ELSE
    RAISE EXCEPTION 'orders must have authoritative status or order_status';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema=s AND table_name='orders' AND column_name='total_amount'
               AND data_type IN ('numeric','integer','bigint','smallint','real','double precision')) THEN
    amount_expr := 'COALESCE(o.total_amount,0)::numeric(14,2)';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema=s AND table_name='orders' AND column_name='total_cents'
               AND data_type IN ('numeric','integer','bigint','smallint')) THEN
    amount_expr := '(COALESCE(o.total_cents,0)::numeric / 100)::numeric(14,2)';
  ELSE
    IF to_regclass(format('%I.order_items',s)) IS NULL THEN
      RAISE EXCEPTION 'Order totals absent; order_items table required to calculate order value';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema=s AND table_name='orders' AND column_name='order_id')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema=s AND table_name='order_items' AND column_name='order_id') THEN
      RAISE EXCEPTION 'orders/order_items require order_id to aggregate actual line items';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema=s AND table_name='order_items' AND column_name='unit_price')
       AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema=s AND table_name='order_items' AND column_name='quantity') THEN
      order_join := format(' LEFT JOIN (SELECT order_id, SUM(unit_price::numeric * quantity)::numeric(14,2) AS amount FROM %I.order_items GROUP BY order_id) li ON li.order_id=o.order_id',s);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema=s AND table_name='order_items' AND column_name='subtotal') THEN
      order_join := format(' LEFT JOIN (SELECT order_id, SUM(subtotal::numeric)::numeric(14,2) AS amount FROM %I.order_items GROUP BY order_id) li ON li.order_id=o.order_id',s);
    ELSE
      RAISE EXCEPTION 'Cannot determine order total from order_items; expected unit_price+quantity or subtotal';
    END IF;
    -- Abort if a collected/completed order lacks line items: don't silently report zero revenue.
    EXECUTE format(
      'SELECT COUNT(*) FROM %I.orders o WHERE UPPER(o.%I::text) IN (''COLLECTED'',''COMPLETED'') AND NOT EXISTS (SELECT 1 FROM %I.order_items oi WHERE oi.order_id=o.order_id)',
      s,status_col,s) INTO bad_completed;
    IF bad_completed > 0 THEN
      RAISE EXCEPTION '% completed orders have no order_items; cannot calculate trustworthy sales totals', bad_completed;
    END IF;
    amount_expr := 'COALESCE(li.amount,0)::numeric(14,2)';
  END IF;
  -- Read-only projection: no new price/status columns on orders and no synchronization triggers.
  view_sql := format(
    'CREATE OR REPLACE VIEW %I.vendor_weekly_order_facts AS SELECT o.stall_id, o.created_at, UPPER(o.%I::text) AS order_status, %s AS total_amount FROM %I.orders o%s',
    s,status_col,amount_expr,s,order_join);
  EXECUTE view_sql;
  RAISE NOTICE 'Created %.vendor_weekly_order_facts using status field %',s,status_col;
END
$ml_vendor_weekly$;
