const pool = require('../db');
const { mapError, toHttpError, ERROR_CODES } = require('../../utils/errors');

// ── Reading orders ───────────────────────────────────────
async function selectOrders(db, customerId, orderId) {
  const params = [customerId];
  let extraFilter = '';
  if (orderId !== undefined) {
    params.push(orderId);
    extraFilter = ' AND o."id" = $2';
  }

  const { rows } = await db.query(
        `SELECT o."id",
        o."orderNumber",
        o."collectionReference",
        o."status",
        o."totalCents",
        o."createdAt",
        o."preparingAt",
        o."readyAt",
        o."collectedAt",
        o."cancelledAt",
        v."id"                AS "stallId",
        v."stallName"         AS "stallName",
        v."pickupLocation"    AS "pickupLocation",
        f."name"              AS "foodCourtName",
        o."pickupWindowStart" AS "pickupStart",
        o."pickupWindowEnd"   AS "pickupEnd",
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi."id",
              'menuItemId', oi."menuItemId",
              'name', oi."name",
              'quantity', oi."quantity",
              'priceCents', oi."unitPriceCents"
            ) ORDER BY oi."id"
          ) FILTER (WHERE oi."id" IS NOT NULL),
          '[]'::json
        ) AS "items"
    FROM "Order" o
    JOIN "Vendor" v     ON v."id" = o."vendorId"
    JOIN "FoodCourt" f  ON f."id" = v."foodCourtId"
    LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
  WHERE o."customerId" = $1${extraFilter}
  GROUP BY o."id", v."id", f."id"
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

    // 1. The customer account must exist and be active.
    const customer = await client.query('SELECT "name", "isActive" FROM "Person" WHERE "id" = $1', [customerId]);
    if (customer.rowCount === 0) {
      throw mapError(ERROR_CODES.UNAUTHENTICATED);
    }
    if (!customer.rows[0].isActive) {
      throw mapError(ERROR_CODES.FORBIDDEN, 'This account cannot place orders.');
    }

    // 2. The stall must exist and be open. FOR UPDATE locks the stall row so two
    const stall = await client.query('SELECT "isActive", "isOpen" FROM "Vendor" WHERE "id" = $1 FOR UPDATE', [stallId]);
    if (stall.rowCount === 0 || !stall.rows[0].isActive) {
      throw mapError(ERROR_CODES.NOT_FOUND, 'That stall was not found.');
    }
    if (!stall.rows[0].isOpen) {
      throw mapError(ERROR_CODES.CONFLICT, 'This stall is not taking orders right now.');
    }

    const itemIds = items.map((line) => line.menuItemId);
    const menu = await client.query(
      `SELECT "id", "name", "priceCents", "isAvailable", "quantityLeft"
         FROM "MenuItem"
        WHERE "vendorId" = $1 AND "id" = ANY($2::int[])
        ORDER BY "id"
          FOR UPDATE`,
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
    const lowStock = items.filter((line) => {
      const left = menuById.get(line.menuItemId).quantityLeft;
      return left !== null && left < line.quantity;
    });
    if (lowStock.length > 0) {
      const names = lowStock.map((line) => menuById.get(line.menuItemId).name);
      throw mapError(ERROR_CODES.CONFLICT, `Not enough stock left: ${names.join(', ')}.`);
    }
    const reserved = await client.query(
      `UPDATE "PickupWindow"
          SET "bookedCount" = "bookedCount" + 1
        WHERE "id" = $1
          AND "stallId" = $2
          AND "isActive" = true
          AND "bookedCount" < "maxOrders"
          AND "startTime" > NOW()
        RETURNING "startTime", "endTime"`,
      [pickupWindowId, stallId],
    );
    if (reserved.rowCount === 0) {
      throw mapError(ERROR_CODES.CONFLICT, 'That pickup time is full or has passed. Choose another one.');
    }
    const slot = reserved.rows[0];

    const numbered = await client.query(
      'SELECT COALESCE(MAX("orderNumber"), 1000) + 1 AS "next" FROM "Order" WHERE "vendorId" = $1',
      [stallId],
    );
    const orderNumber = numbered.rows[0].next;
    const totalCents = items.reduce(
      (sum, line) => sum + line.quantity * menuById.get(line.menuItemId).priceCents,
      0,
    );

  const collectionReference = 'ML-' + Math.random().toString(36).slice(2, 10).toUpperCase();

  const inserted = await client.query(
    `INSERT INTO "Order" ("vendorId", "orderNumber", "customerId", "pickupWindowId",
                          "customerName", "collectionReference",
                          "pickupWindowStart", "pickupWindowEnd", "totalCents")
    VALUES ($1, $2, $3, $4, left($5, 60), $6, $7, $8, $9)
    RETURNING "id"`,
    [stallId, orderNumber, customerId, pickupWindowId, customer.rows[0].name,
    collectionReference, slot.startTime, slot.endTime, totalCents],
  );
    orderId = inserted.rows[0].id;

    const orderItemParams = [orderId];
    const placeholders = items.map((line, index) => {
      const menuItem = menuById.get(line.menuItemId);
      const base = 1 + index * 4;
      orderItemParams.push(line.menuItemId, menuItem.name, menuItem.priceCents, line.quantity);
      return `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });
    await client.query(
      `INSERT INTO "OrderItem" ("orderId", "menuItemId", "name", "unitPriceCents", "quantity")
       VALUES ${placeholders.join(', ')}`,
      orderItemParams,
    );

    for (const line of items) {
      if (menuById.get(line.menuItemId).quantityLeft !== null) {
        await client.query(
          `UPDATE "MenuItem"
              SET "quantityLeft" = "quantityLeft" - $2::int,
                  "isSoldOut" = ("quantityLeft" = $2::int),
                  "updatedAt" = NOW()
            WHERE "id" = $1`,
          [line.menuItemId, line.quantity],
        );
      }
    }

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