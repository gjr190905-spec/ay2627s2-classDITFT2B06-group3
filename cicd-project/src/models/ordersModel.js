const createError = require('http-errors');
const pool = require('./db');

const orderColumns = `
  "id" AS order_id,
  "customerId" AS customer_id,
  "vendorId" AS stall_id,
  "pickupWindowId" AS pickup_window_id,
  ("totalCents" / 100.0)::numeric(10, 2) AS total_amount,
  "status" AS order_status,
  "createdAt" AS created_at
`;

module.exports.createOrder = async function createOrder(order) {
  if (!Number.isInteger(order.customerId) || order.customerId <= 0) {
    throw createError(400, 'Invalid customer ID');
  }

  if (!Number.isInteger(order.stallId) || order.stallId <= 0) {
    throw createError(400, 'Invalid stall ID');
  }

  if (!Number.isInteger(order.pickupWindowId) || order.pickupWindowId <= 0) {
    throw createError(400, 'Invalid pickup window ID');
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw createError(400, 'At least one menu item is required');
  }

  const menuItemIds = new Set();

  for (const item of order.items) {
    if (
      !item ||
      !Number.isInteger(item.menuItemId) ||
      item.menuItemId <= 0 ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 99
    ) {
      throw createError(400, 'Invalid menu item ID or quantity');
    }

    if (menuItemIds.has(item.menuItemId)) {
      throw createError(400, 'Duplicate menu items are not allowed');
    }

    menuItemIds.add(item.menuItemId);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Serialize order number allocation for this stall.
    const { rows: [stall] } = await client.query(
      `SELECT "id"
       FROM "Vendor"
       WHERE "id" = $1 AND "isActive" = TRUE
       FOR NO KEY UPDATE`,
      [order.stallId]
    );

    if (!stall) {
      throw createError(400, 'Stall not found or inactive');
    }

    // Reserve a slot only if the window belongs to the stall and has capacity.
    const { rows: [pickupWindow] } = await client.query(
      `UPDATE "PickupWindow"
       SET "bookedCount" = "bookedCount" + 1
       WHERE "id" = $1
         AND "stallId" = $2
         AND "isActive" = TRUE
         AND "startTime" > CURRENT_TIMESTAMP
         AND "bookedCount" < "maxOrders"
       RETURNING "startTime", "endTime"`,
      [order.pickupWindowId, order.stallId]
    );

    if (!pickupWindow) {
      throw createError(400, 'Pickup window is unavailable or fully booked');
    }

    let totalCents = 0;
    const validatedItems = [];

    for (const item of order.items) {
      const { rows: [menuItem] } = await client.query(
        `SELECT "id", "name", "priceCents"
         FROM "MenuItem"
         WHERE "id" = $1
           AND "vendorId" = $2
           AND "isAvailable" = TRUE`,
        [item.menuItemId, order.stallId]
      );

      if (!menuItem) {
        throw createError(400, 'Menu item not found or unavailable');
      }

      totalCents += menuItem.priceCents * item.quantity;
      validatedItems.push({
        menuItemId: menuItem.id,
        name: menuItem.name,
        unitPriceCents: menuItem.priceCents,
        quantity: item.quantity
      });
    }

    const { rows: [newOrder] } = await client.query(
      `INSERT INTO "Order" (
         "vendorId", "orderNumber", "customerId", "pickupWindowId",
         "pickupWindowStart", "pickupWindowEnd", "totalCents"
       )
       SELECT $1, COALESCE(MAX("orderNumber"), 0) + 1, $2, $3, $4, $5, $6
       FROM "Order"
       WHERE "vendorId" = $1
       RETURNING ${orderColumns}`,
      [
        order.stallId,
        order.customerId,
        order.pickupWindowId,
        pickupWindow.startTime,
        pickupWindow.endTime,
        totalCents
      ]
    );

    for (const item of validatedItems) {
      await client.query(
        `INSERT INTO "OrderItem" (
           "orderId", "menuItemId", "name", "unitPriceCents", "quantity"
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [
          newOrder.order_id,
          item.menuItemId,
          item.name,
          item.unitPriceCents,
          item.quantity
        ]
      );
    }

    await client.query(
      `INSERT INTO payments (order_id, amount, payment_status)
       VALUES ($1, $2, 'PENDING')`,
      [newOrder.order_id, newOrder.total_amount]
    );

    await client.query('COMMIT');
    return newOrder;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports.getCustomerOrders = async function getCustomerOrders(customerId) {
  const { rows } = await pool.query(
    `SELECT ${orderColumns}
     FROM "Order"
     WHERE "customerId" = $1
     ORDER BY "createdAt" DESC, "id" DESC`,
    [customerId]
  );

  return rows;
};

module.exports.getOrderById = async function getOrderById(orderId, customerId) {
  const { rows } = await pool.query(
    `SELECT ${orderColumns}
     FROM "Order"
     WHERE "id" = $1 AND "customerId" = $2`,
    [orderId, customerId]
  );

  return rows[0];
};

module.exports.getVendorOrders = async function getVendorOrders(stallId) {
  const { rows } = await pool.query(
    `SELECT ${orderColumns}
     FROM "Order"
     WHERE "vendorId" = $1
     ORDER BY "createdAt" DESC, "id" DESC`,
    [stallId]
  );

  return rows;
};

module.exports.updateOrderStatus = async function updateOrderStatus(
  orderId,
  stallId,
  status
) {
  const { rows } = await pool.query(
    `UPDATE "Order"
     SET "status" = $1,
         "preparingAt" = CASE
           WHEN $1 = 'PREPARING' THEN CURRENT_TIMESTAMP
           ELSE "preparingAt"
         END,
         "readyAt" = CASE
           WHEN $1 = 'READY' THEN CURRENT_TIMESTAMP
           ELSE "readyAt"
         END
     WHERE "id" = $2
       AND "vendorId" = $3
       AND (
         ("status" = 'CONFIRMED' AND $1 = 'PREPARING')
         OR ("status" = 'PREPARING' AND $1 = 'READY')
       )
     RETURNING ${orderColumns}`,
    [status, orderId, stallId]
  );

  return rows[0];
};