const pool = require('./db');

const LIST_LIMIT = 50;

/**
 * The notifications to create for a newly placed order, honouring the vendor's choices.
 * A pure function, so the rules can be tested without a database.
 *
 * @param {object} order      { id, orderNumber, totalCents, windowLabel, itemCount }
 * @param {object[]} stock    one entry per counted item: { menuItemId, name, before, after }
 * @param {object} prefs      { newOrder, soldOut, lowStock, lowStockThreshold }
 * @returns {{type: string, message: string, orderId: number, menuItemId: number|null}[]}
 */
function notificationsForOrder(order, stock, prefs) {
  const list = [];
  if (prefs.newOrder) {
    const items = `${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}`;
    list.push({
      type: 'NEW_ORDER',
      message: `New order #${order.orderNumber} for ${order.windowLabel} (${items}, $${(order.totalCents / 100).toFixed(2)})`,
      orderId: order.id,
      menuItemId: null,
    });
  }
  stock.forEach(({ menuItemId, name, before, after }) => {
    if (after === 0 && prefs.soldOut) {
      list.push({
        type: 'SOLD_OUT',
        message: `${name} is sold out (last one went in order #${order.orderNumber})`,
        orderId: order.id,
        menuItemId,
      });
    } else if (
      after > 0 &&
      prefs.lowStock &&
      before > prefs.lowStockThreshold &&
      after <= prefs.lowStockThreshold
    ) {
      // Only when it first drops to the threshold, so the vendor isn't told on every order
      list.push({
        type: 'LOW_STOCK',
        message: `Only ${after} ${name} left`,
        orderId: order.id,
        menuItemId,
      });
    }
  });
  return list;
}

module.exports.LIST_LIMIT = LIST_LIMIT;
module.exports.notificationsForOrder = notificationsForOrder;

/**
 * Save notifications (inside the caller's transaction).
 * @param {{query: Function}} db  transaction client
 */
module.exports.createNotifications = async function createNotifications(db, vendorId, list) {
  if (list.length === 0) return;
  const values = [];
  const placeholders = list.map((n, i) => {
    values.push(vendorId, n.type, n.message, n.orderId, n.menuItemId);
    const b = i * 5;
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
  });
  await db.query(
    `INSERT INTO "VendorNotification" ("vendorId", "type", "message", "orderId", "menuItemId")
     VALUES ${placeholders.join(', ')}`,
    values,
  );
};

/**
 * The vendor's latest notifications (newest first) and how many are unread.
 * @returns {Promise<{unreadCount: number, notifications: object[]}|undefined>}
 *          undefined if the vendor does not exist
 */
module.exports.listNotifications = async function listNotifications(vendorId) {
  const vendor = await pool.query('SELECT "id" FROM "Vendor" WHERE "id" = $1', [vendorId]);
  if (vendor.rows.length === 0) return undefined;

  const [list, unread] = await Promise.all([
    pool.query(
      `SELECT "id", "type", "message", "orderId", "menuItemId", "createdAt", "readAt"
       FROM "VendorNotification"
       WHERE "vendorId" = $1
       ORDER BY "createdAt" DESC, "id" DESC
       LIMIT ${LIST_LIMIT}`,
      [vendorId],
    ),
    pool.query(
      'SELECT COUNT(*)::int AS "count" FROM "VendorNotification" WHERE "vendorId" = $1 AND "readAt" IS NULL',
      [vendorId],
    ),
  ]);
  return { unreadCount: unread.rows[0].count, notifications: list.rows };
};

/**
 * Mark every unread notification as read.
 * @returns {Promise<{unreadCount: 0, marked: number}|undefined>} undefined if no such vendor
 */
module.exports.markAllRead = async function markAllRead(vendorId) {
  const vendor = await pool.query('SELECT "id" FROM "Vendor" WHERE "id" = $1', [vendorId]);
  if (vendor.rows.length === 0) return undefined;
  const result = await pool.query(
    'UPDATE "VendorNotification" SET "readAt" = NOW() WHERE "vendorId" = $1 AND "readAt" IS NULL',
    [vendorId],
  );
  return { unreadCount: 0, marked: result.rowCount };
};

/**
 * Delete all of the vendor's notifications.
 * @returns {Promise<{unreadCount: 0, deleted: number}|undefined>} undefined if no such vendor
 */
module.exports.clearNotifications = async function clearNotifications(vendorId) {
  const vendor = await pool.query('SELECT "id" FROM "Vendor" WHERE "id" = $1', [vendorId]);
  if (vendor.rows.length === 0) return undefined;
  const result = await pool.query('DELETE FROM "VendorNotification" WHERE "vendorId" = $1', [
    vendorId,
  ]);
  return { unreadCount: 0, deleted: result.rowCount };
};
