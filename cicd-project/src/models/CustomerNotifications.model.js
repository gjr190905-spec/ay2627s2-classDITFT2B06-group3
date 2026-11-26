'use strict';
const pool = require('./db');

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function error(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function toPublic(row) {
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    type: row.event_type,
    title: row.title,
    message: row.message,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}
async function list(customerId) {
  const id = validId(customerId);
  if (!id) throw error(401, 'Sign in to view notifications.');
  const [items, count] = await Promise.all([
    pool.query(`SELECT id, order_id, event_type, title, message, created_at, read_at
      FROM ml_customer_notifications
      WHERE customer_id = $1 AND dismissed_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT 50`, [id]),
    pool.query(`SELECT COUNT(*)::integer AS unread
      FROM ml_customer_notifications
      WHERE customer_id = $1 AND dismissed_at IS NULL AND read_at IS NULL`, [id]),
  ]);
  return {
    notifications: items.rows.map(toPublic),
    unreadCount: Number(count.rows[0]?.unread || 0),
  };
}
async function markRead(customerId, notificationId) {
  const owner = validId(customerId);
  const notification = validId(notificationId);
  if (!owner) throw error(401, 'Sign in to manage notifications.');
  if (!notification) throw error(400, 'Invalid notification ID.');
  const { rows } = await pool.query(`UPDATE ml_customer_notifications
    SET read_at = COALESCE(read_at, NOW())
    WHERE id = $1 AND customer_id = $2 AND dismissed_at IS NULL
    RETURNING id, order_id, event_type, title, message, created_at, read_at`, [notification, owner]);
  if (!rows.length) throw error(404, 'Notification not found.');
  return { notification: toPublic(rows[0]) };
}
async function dismiss(customerId, notificationId) {
  const owner = validId(customerId);
  const notification = validId(notificationId);
  if (!owner) throw error(401, 'Sign in to manage notifications.');
  if (!notification) throw error(400, 'Invalid notification ID.');
  const { rows } = await pool.query(`UPDATE ml_customer_notifications
    SET dismissed_at = NOW()
    WHERE id = $1 AND customer_id = $2 AND dismissed_at IS NULL
    RETURNING id`, [notification, owner]);
  if (!rows.length) throw error(404, 'Notification not found.');
  return { ok: true, dismissedId: Number(rows[0].id) };
}
async function insertOrderPlaced(client, { customerId, orderId, orderNumber, stallName }) {
  const owner = validId(customerId);
  const order = validId(orderId);
  if (!owner || !order) throw error(400, 'Invalid notification order.');
  const title = 'Order placed';
  const message = `Order ${String(orderNumber).slice(0, 60)} at ${String(stallName).slice(0, 80)} has been placed. Pay at pickup.`;
  await client.query(`INSERT INTO ml_customer_notifications
    (customer_id, order_id, event_type, title, message)
    VALUES ($1, $2, 'ORDER_PLACED', $3, $4)
    ON CONFLICT (customer_id, order_id, event_type) DO NOTHING`, [owner, order, title, message]);
}
module.exports = { validId, toPublic, list, markRead, dismiss, insertOrderPlaced };
