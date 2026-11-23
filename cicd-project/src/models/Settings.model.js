const pool = require('./db');

// What a vendor gets before they save any settings
const DEFAULT_SETTINGS = Object.freeze({
  maxActiveOrders: null,
  notifications: Object.freeze({
    newOrder: true,
    soldOut: true,
    lowStock: true,
    lowStockThreshold: 3,
  }),
});

// Orders that count against the limit: taken on, but not ready yet
const ACTIVE_STATUSES = ['CONFIRMED', 'PREPARING'];

/** Turn a "VendorSettings" row (or no row) into the shape the API sends. */
function toSettings(row) {
  if (!row) {
    return { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications } };
  }
  return {
    maxActiveOrders: row.maxActiveOrders,
    notifications: {
      newOrder: row.notifyNewOrder,
      soldOut: row.notifySoldOut,
      lowStock: row.notifyLowStock,
      lowStockThreshold: row.lowStockThreshold,
    },
  };
}

module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
module.exports.toSettings = toSettings;

/**
 * The settings and current load that ordering needs: the order limit, how many orders
 * are in progress, and the notification choices. Pass the transaction client when the
 * stall row is locked, so the count can't change before the order is saved.
 *
 * @param {{query: Function}} db  pool or transaction client
 * @returns {Promise<{maxActiveOrders: number|null, activeOrders: number, notifications: object}>}
 */
async function loadOrderingRules(db, vendorId) {
  const [settings, active] = await Promise.all([
    db.query('SELECT * FROM "VendorSettings" WHERE "vendorId" = $1', [vendorId]),
    db.query(
      'SELECT COUNT(*)::int AS "count" FROM "Order" WHERE "vendorId" = $1 AND "status" = ANY($2)',
      [vendorId, ACTIVE_STATUSES],
    ),
  ]);
  return { ...toSettings(settings.rows[0]), activeOrders: active.rows[0].count };
}

module.exports.loadOrderingRules = loadOrderingRules;

/**
 * A vendor's settings, plus how many orders are in progress right now.
 * @returns {Promise<object|undefined>} undefined if the vendor does not exist
 */
module.exports.getSettings = async function getSettings(vendorId) {
  const vendor = await pool.query('SELECT "id" FROM "Vendor" WHERE "id" = $1', [vendorId]);
  if (vendor.rows.length === 0) return undefined;
  return loadOrderingRules(pool, vendorId);
};

/**
 * Save all of a vendor's settings (insert the row the first time, replace it after).
 *
 * @param {number} vendorId
 * @param {{maxActiveOrders: number|null, notifications: {newOrder, soldOut, lowStock, lowStockThreshold}}} settings
 * @returns {Promise<object|undefined>} the saved settings with the current load,
 *          or undefined if the vendor does not exist
 */
module.exports.saveSettings = async function saveSettings(vendorId, settings) {
  const n = settings.notifications;
  try {
    await pool.query(
      `INSERT INTO "VendorSettings" ("vendorId", "maxActiveOrders", "notifyNewOrder",
         "notifySoldOut", "notifyLowStock", "lowStockThreshold", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT ("vendorId") DO UPDATE SET
         "maxActiveOrders" = EXCLUDED."maxActiveOrders",
         "notifyNewOrder" = EXCLUDED."notifyNewOrder",
         "notifySoldOut" = EXCLUDED."notifySoldOut",
         "notifyLowStock" = EXCLUDED."notifyLowStock",
         "lowStockThreshold" = EXCLUDED."lowStockThreshold",
         "updatedAt" = NOW()`,
      [vendorId, settings.maxActiveOrders, n.newOrder, n.soldOut, n.lowStock, n.lowStockThreshold],
    );
  } catch (error) {
    if (error.code === '23503') return undefined; // no such vendor
    throw error;
  }
  return loadOrderingRules(pool, vendorId);
};
