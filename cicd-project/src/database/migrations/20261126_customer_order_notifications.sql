BEGIN;
CREATE TABLE IF NOT EXISTS ml_customer_notifications (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('ORDER_PLACED')),
  title VARCHAR(120) NOT NULL,
  message VARCHAR(400) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  UNIQUE (customer_id, order_id, event_type)
);
CREATE INDEX IF NOT EXISTS ml_customer_notifications_inbox_idx
  ON ml_customer_notifications (customer_id, created_at DESC)
  WHERE dismissed_at IS NULL;
COMMIT;
