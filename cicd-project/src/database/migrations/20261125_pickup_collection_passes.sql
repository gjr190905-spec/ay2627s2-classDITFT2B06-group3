-- Additive collection token store; does not alter the existing orders/users/payment tables.
-- Only the QR token digest is stored. A token is valid for one READY order only.
CREATE TABLE IF NOT EXISTS pickup_collection_passes (
  order_id BIGINT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  collected_at TIMESTAMPTZ,
  collected_by BIGINT
);
-- No FK until the team's authoritative orders key type and schema are confirmed.
