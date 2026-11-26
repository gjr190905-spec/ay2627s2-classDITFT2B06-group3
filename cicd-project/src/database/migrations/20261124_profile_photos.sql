-- Additive profile-photo storage for the existing physical users table.
-- Does not alter existing users columns or existing customer/vendor/order data.
CREATE TABLE IF NOT EXISTS user_profile_images (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  image_data BYTEA NOT NULL CHECK (octet_length(image_data) BETWEEN 1 AND 524288),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
