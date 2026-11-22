const pool = require('./db');
const { mapError, toHttpError, ERROR_CODES } = require('../utils/errors');

async function selectOrders(db, customerId, orderId) {
  const params = [customerId];
  let extraFilter = '';
  if (orderId !== undefined) {
    params.push(orderId);
    extraFilter = ' AND o."id" = $2';
  }

  const { rows } = await db.query(
    `SELECT o."id",
            o."status",
            o."totalCents",
            o."createdAt",
            o."readyAt",
            o."collectedAt",
            s."id"             AS "stallId",
            s."name"           AS "stallName",
            s."pickupLocation" AS "pickupLocation",
            w."startTime"      AS "pickupStart",
            w."endTime"        AS "pickupEnd",
            COALESCE(
              json_agg(
                json_build_object(
                  'id', oi."id",
                  'menuItemId', oi."menuItemId",
                  'name', oi."itemName",
                  'quantity', oi."quantity",
                  'priceCents', oi."priceCentsAtOrder"
                ) ORDER BY oi."id"
              ) FILTER (WHERE oi."id" IS NOT NULL),
              '[]'::json
            ) AS "items"
       FROM "Order" o
       JOIN "Stall" s        ON s."id" = o."stallId"
       JOIN "PickupWindow" w ON w."id" = o."pickupWindowId"
       LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE o."customerId" = $1${extraFilter}
      GROUP BY o."id", s."id", w."id"
      ORDER BY o."createdAt" DESC, o."id" DESC`,
    params,
  );
  return rows;
}

module.exports.listOrdersForCustomer = async function listOrdersForCustomer(customerId) {
  return selectOrders(pool, customerId);
};

module.exports.getOrderForCustomer = async function getOrderForCustomer(customerId, orderId) {
  const rows = await selectOrders(pool, customerId, orderId);
  return rows[0] || null;
};

// ── Checkout ─────────────────────────────────────────────
module.exports.createOrder = async function createOrder({ customerId, stallId, pickupWindowId, items }) {
  const client = await pool.connect();
  let orderId;

  try {
    await client.query('BEGIN');

    const stall = await client.query(
      'SELECT "id" FROM "Stall" WHERE "id" = $1 AND "isActive" = true',
      [stallId],
    );
    if (stall.rowCount === 0) {
      throw mapError(ERROR_CODES.NOT_FOUND, 'That stall was not found.');
    }
    const itemIds = items.map((line) => line.menuItemId);
    const menu = await client.query(
      `SELECT "id", "name", "priceCents", "isAvailable"
         FROM "MenuItem"
        WHERE "stallId" = $1 AND "id" = ANY($2::int[])`,
      [stallId, itemIds],
    );
    const menuById = new Map(menu.rows.map((row) => [row.id, row]));

    if (itemIds.some((id) => !menuById.has(id))) {
      throw mapError(ERROR_CODES.INVALID_INPUT, 'One or more items are not on this stall menu.');
    }
    const soldOut = items.filter((line) => !menuById.get(line.menuItemId).isAvailable);
    if (soldOut.length > 0) {
      const names = soldOut.map((line) => menuById.get(line.menuItemId).name);
      throw mapError(ERROR_CODES.CONFLICT, `Sold out: ${names.join(', ')}.`);
    }
    const reserved = await client.query(
      `UPDATE "PickupWindow"
          SET "bookedCount" = "bookedCount" + 1
        WHERE "id" = $1
          AND "stallId" = $2
          AND "bookedCount" < "maxOrders"
          AND "startTime" > NOW()
        RETURNING "id"`,
      [pickupWindowId, stallId],
    );
    if (reserved.rowCount === 0) {
      throw mapError(ERROR_CODES.CONFLICT, 'That pickup time is full or has passed. Choose another one.');
    }

    const totalCents = items.reduce(
      (sum, line) => sum + line.quantity * menuById.get(line.menuItemId).priceCents,
      0,
    );

    const inserted = await client.query(
      `INSERT INTO "Order" ("customerId", "stallId", "pickupWindowId", "totalCents")
       VALUES ($1, $2, $3, $4)
       RETURNING "id"`,
      [customerId, stallId, pickupWindowId, totalCents],
    );
    orderId = inserted.rows[0].id;

    const orderItemParams = [orderId];
    const placeholders = items.map((line, index) => {
      const menuItem = menuById.get(line.menuItemId);
      const base = 1 + index * 4;
      orderItemParams.push(line.menuItemId, menuItem.name, line.quantity, menuItem.priceCents);
      return `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });
    await client.query(
      `INSERT INTO "OrderItem" ("orderId", "menuItemId", "itemName", "quantity", "priceCentsAtOrder")
       VALUES ${placeholders.join(', ')}`,
      orderItemParams,
    );

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(rollbackError);
    }
    throw toHttpError(error);
  } finally {
    client.release();
  }

  return module.exports.getOrderForCustomer(customerId, orderId);
};