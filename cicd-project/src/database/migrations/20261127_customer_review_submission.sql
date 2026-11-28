-- Makan Liao? Day 12: real PostgreSQL review submission; never touches prototype data.
-- Run against the same PostgreSQL database as .env.dev. Safe to rerun.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
      SELECT 1 FROM (VALUES ('orders','id'),('orders','customer_id'),('orders','stall_id'),
                          ('orders','status'),('users','id'),('stalls','id')) AS needed(tbl,col)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema='public' AND c.table_name=needed.tbl AND c.column_name=needed.col
      )
    ) THEN
    RAISE EXCEPTION 'Expected live orders(id, customer_id, stall_id, status), users(id) and stalls(id). Nothing migrated.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ml_customer_reviews (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stall_id BIGINT NOT NULL REFERENCES stalls(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment VARCHAR(800) NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 10 AND 800),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ml_customer_review_once_per_order UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS ml_customer_reviews_stall_status_idx
  ON ml_customer_reviews (stall_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ml_customer_reviews_customer_created_idx
  ON ml_customer_reviews (customer_id, created_at DESC);
COMMIT;
