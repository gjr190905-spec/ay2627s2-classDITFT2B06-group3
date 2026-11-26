-- Makan Liao: database-backed notifications for every signed-in role.
-- Idempotent. Does not reset existing data or modify teammate notification tables.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='stall_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='stalls' AND column_name='name'
  ) THEN
    RAISE EXCEPTION 'Live users(stall_id), orders(status), stalls(name) schema required. No migration applied.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ml_activity_notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key VARCHAR(220) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  title VARCHAR(120) NOT NULL,
  message VARCHAR(400) NOT NULL,
  entity_type VARCHAR(30),
  entity_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  UNIQUE (recipient_user_id, event_key)
);
CREATE INDEX IF NOT EXISTS ml_activity_notifications_unread_idx
  ON ml_activity_notifications(recipient_user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

-- Called INSIDE the same transaction as an order write. Failed orders never emit alerts.
CREATE OR REPLACE FUNCTION ml_notify_order_event() RETURNS TRIGGER AS $$
DECLARE stall_title TEXT;
BEGIN
  SELECT name INTO stall_title FROM stalls WHERE id=NEW.stall_id;
  stall_title := COALESCE(stall_title, 'your stall');
  IF TG_OP='INSERT' THEN
    INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
      SELECT u.id, 'order:'||NEW.id||':customer:placed', 'ORDER_PLACED', 'Order placed',
        'Order '||COALESCE(NEW.order_number::text,NEW.id::text)||' at '||left(stall_title,80)||' was placed.', 'order', NEW.id
      FROM users u WHERE u.id=NEW.customer_id AND u.role='customer' AND u.is_active=1
      ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
    INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
      SELECT u.id, 'order:'||NEW.id||':vendor:received', 'ORDER_RECEIVED', 'New order received',
        'Order '||COALESCE(NEW.order_number::text,NEW.id::text)||' was received by '||left(stall_title,80)||'.', 'order', NEW.id
      FROM users u WHERE u.stall_id=NEW.stall_id AND u.role='vendor' AND u.is_active=1
      ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status IN ('ACCEPTED','PREPARING','READY','CANCELLED','COLLECTED') THEN
      INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
        SELECT u.id, 'order:'||NEW.id||':customer:'||NEW.status, 'ORDER_'||NEW.status,
          CASE NEW.status WHEN 'ACCEPTED' THEN 'Order accepted' WHEN 'PREPARING' THEN 'Preparing your food'
            WHEN 'READY' THEN 'Ready for collection' WHEN 'CANCELLED' THEN 'Order cancelled' ELSE 'Order collected' END,
          'Order '||COALESCE(NEW.order_number::text,NEW.id::text)||' at '||left(stall_title,80)||' is '||lower(NEW.status)||'.', 'order', NEW.id
        FROM users u WHERE u.id=NEW.customer_id AND u.role='customer' AND u.is_active=1
        ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
    END IF;
    IF NEW.status IN ('PREPARING','READY','CANCELLED') THEN
      INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
        SELECT u.id, 'order:'||NEW.id||':vendor:'||NEW.status, 'VENDOR_ORDER_'||NEW.status,
          CASE NEW.status WHEN 'PREPARING' THEN 'Order in preparation' WHEN 'READY' THEN 'Food marked ready' ELSE 'Order cancelled' END,
          'Order '||COALESCE(NEW.order_number::text,NEW.id::text)||' is '||lower(NEW.status)||'.', 'order', NEW.id
        FROM users u WHERE u.stall_id=NEW.stall_id AND u.role='vendor' AND u.is_active=1
        ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ml_activity_orders_notify ON orders;
CREATE TRIGGER ml_activity_orders_notify
  AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION ml_notify_order_event();

CREATE OR REPLACE FUNCTION ml_notify_stall_event() RETURNS TRIGGER AS $$
DECLARE what TEXT; display_name TEXT; ident BIGINT; event_key TEXT;
BEGIN
  IF TG_OP='DELETE' THEN
    what := 'Stall removed'; ident:=OLD.id; display_name:=OLD.name;
    event_key := 'stall:'||ident||':removed';
  ELSIF OLD.name IS DISTINCT FROM NEW.name THEN
    what := 'Stall renamed'; ident:=NEW.id; display_name:=NEW.name;
    event_key := 'stall:'||ident||':renamed:'||md5(NEW.name);
  ELSIF OLD.is_open IS DISTINCT FROM NEW.is_open THEN
    what := CASE WHEN NEW.is_open=1 THEN 'Stall reopened' ELSE 'Stall closed' END;
    ident:=NEW.id; display_name:=NEW.name;
    event_key := 'stall:'||ident||':open:'||NEW.is_open||':'||md5(CURRENT_TIMESTAMP::text);
  ELSE RETURN NEW;
  END IF;
  INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
    SELECT u.id, event_key, CASE WHEN TG_OP='DELETE' THEN 'STALL_REMOVED' WHEN what='Stall renamed' THEN 'STALL_RENAMED' ELSE 'STALL_STATUS' END,
      what, left(COALESCE(display_name,'Stall'),80)||': '||what||'.', 'stall',ident
    FROM users u WHERE u.is_active=1 AND (u.role='admin' OR (u.role='vendor' AND u.stall_id=ident))
    ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ml_activity_stall_update ON stalls;
DROP TRIGGER IF EXISTS ml_activity_stall_delete ON stalls;
CREATE TRIGGER ml_activity_stall_update AFTER UPDATE OF name,is_open ON stalls
 FOR EACH ROW EXECUTE FUNCTION ml_notify_stall_event();
CREATE TRIGGER ml_activity_stall_delete BEFORE DELETE ON stalls
 FOR EACH ROW EXECUTE FUNCTION ml_notify_stall_event();

-- New stall registrations are operational events for administrators.
CREATE OR REPLACE FUNCTION ml_notify_stall_created() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
    SELECT u.id,'stall:'||NEW.id||':created','STALL_CREATED','New stall added',
      'Stall '||left(NEW.name,80)||' has been added.', 'stall',NEW.id
    FROM users u WHERE u.role='admin' AND u.is_active=1
    ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ml_activity_stall_created ON stalls;
CREATE TRIGGER ml_activity_stall_created AFTER INSERT ON stalls
 FOR EACH ROW EXECUTE FUNCTION ml_notify_stall_created();

-- Reviews may not yet be integrated on this branch. Attach automatically when a
-- compatible real reviews table exists; never claim a mock is a saved review.
CREATE OR REPLACE FUNCTION ml_notify_review_event() RETURNS TRIGGER AS $$
DECLARE e TEXT; heading TEXT;
BEGIN
  IF TG_OP='INSERT' THEN
    e:='REVIEW_PENDING'; heading:='Review awaiting moderation';
    INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
      SELECT u.id,'review:'||NEW.id||':pending','REVIEW_PENDING',heading,
        'A customer review needs moderation.', 'review',NEW.id
      FROM users u WHERE u.role='admin' AND u.is_active=1
      ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    IF upper(NEW.status::text) IN ('APPROVED','PUBLISHED','RELEASED') THEN
      INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
        SELECT u.id,'review:'||NEW.id||':published:'||u.role,'REVIEW_RELEASED','Review released',
          'A customer review has been approved and released.', 'review',NEW.id
        FROM users u WHERE u.is_active=1 AND
          ((u.role='vendor' AND u.stall_id=NEW.stall_id) OR (u.role='customer' AND u.id=NEW.customer_id))
        ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
    ELSIF upper(NEW.status::text) IN ('REJECTED','REMOVED') THEN
      INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
        SELECT u.id,'review:'||NEW.id||':rejected:'||upper(NEW.status::text),'REVIEW_MODERATED','Review moderated',
          'The moderation decision for your review has been updated.', 'review',NEW.id
        FROM users u WHERE u.id=NEW.customer_id AND u.role='customer' AND u.is_active=1
        ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
    ELSIF upper(NEW.status::text)='REPORTED' THEN
      INSERT INTO ml_activity_notifications(recipient_user_id,event_key,event_type,title,message,entity_type,entity_id)
        SELECT u.id,'review:'||NEW.id||':reported','REVIEW_REPORTED','Reported review',
          'A review has been reported and needs attention.', 'review',NEW.id
        FROM users u WHERE u.role='admin' AND u.is_active=1
        ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$
BEGIN
  IF to_regclass('public.reviews') IS NOT NULL
     AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews'
          AND column_name IN ('id','stall_id','customer_id','status'))=4 THEN
    EXECUTE 'DROP TRIGGER IF EXISTS ml_activity_review_notify ON reviews';
    EXECUTE 'CREATE TRIGGER ml_activity_review_notify AFTER INSERT OR UPDATE OF status ON reviews FOR EACH ROW EXECUTE FUNCTION ml_notify_review_event()';
    RAISE NOTICE 'Review notification trigger installed on reviews.';
  ELSE
    RAISE NOTICE 'Review table not integrated yet: moderation triggers not installed.';
  END IF;
END $$;
COMMIT;
