const pool = require('./db');
const { checkBasket } = require('./Menu.model');
const { loadOrderingRules } = require('./Settings.model');
const { notificationsForOrder, createNotifications } = require('./Notification.model');

// Days, "today" and pickup-window dates are all Singapore time
const TIME_ZONE = 'Asia/Singapore';

// The step before each status, and the timestamp each step records
const PREVIOUS_STATUS = { PREPARING: 'CONFIRMED', READY: 'PREPARING' };
const STEP_TIMESTAMP = { PREPARING: 'preparingAt', READY: 'readyAt' };

// "o" is "Order", "p" is the shared "payments" table (one row per checkout order that was
// paid, or is being paid, online). Manual orders have no customer, window or payment row.
const ORDER_COLUMNS = `
  o."id", o."vendorId", o."orderNumber", o."customerId", o."pickupWindowId",
  o."collectionReference", o."customerName", o."status",
  o."pickupWindowStart", o."pickupWindowEnd", o."totalCents", o."createdAt",
  o."preparingAt", o."readyAt", o."collectedAt", o."cancelledAt",
  p.payment_status AS "paymentStatus", p.payment_method AS "paymentMethod"`;

// Orders that count towards the figures on the dashboard charts
const NOT_CANCELLED = `o."status" <> 'CANCELLED'`;

/**
 * Turn an order row and its item rows into the shape the API sends.
 * "readyOnTime" answers "was it ready by the end of the booked window?"
 * (null until the order has been marked Ready).
 * "payment" is the online payment for a checkout order, or null when the student pays at
 * the stall (manual orders, or checkout orders without a payment record).
 */
function toOrder(row, itemRows) {
  return {
    id: row.id,
    vendorId: row.vendorId,
    orderNumber: row.orderNumber,
    customerId: row.customerId,
    pickupWindowId: row.pickupWindowId,
    collectionReference: row.collectionReference,
    customerName: row.customerName,
    status: row.status,
    pickupWindowStart: row.pickupWindowStart,
    pickupWindowEnd: row.pickupWindowEnd,
    totalCents: row.totalCents,
    items: itemRows.map((item) => ({
      menuItemId: item.menuItemId,
      name: item.name,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      lineTotalCents: item.unitPriceCents * item.quantity,
    })),
    createdAt: row.createdAt,
    preparingAt: row.preparingAt,
    readyAt: row.readyAt,
    collectedAt: row.collectedAt,
    cancelledAt: row.cancelledAt,
    payment: row.paymentStatus ? { status: row.paymentStatus, method: row.paymentMethod } : null,
    readyOnTime: row.readyAt ? row.readyAt.getTime() <= row.pickupWindowEnd.getTime() : null,
  };
}

/**
 * Group orders by pickup window, earliest window first. Orders inside a window keep
 * the order they came in (by order number).
 *
 * @param {object[]} orders  already sorted by window start, window end, order number
 * @returns {{start: Date, end: Date, orders: object[]}[]}
 */
function groupByPickupWindow(orders) {
  const windows = [];
  orders.forEach((order) => {
    const last = windows[windows.length - 1];
    if (
      last &&
      last.start.getTime() === order.pickupWindowStart.getTime() &&
      last.end.getTime() === order.pickupWindowEnd.getTime()
    ) {
      last.orders.push(order);
    } else {
      windows.push({ start: order.pickupWindowStart, end: order.pickupWindowEnd, orders: [order] });
    }
  });
  return windows;
}

module.exports.TIME_ZONE = TIME_ZONE;
module.exports.toOrder = toOrder;
module.exports.groupByPickupWindow = groupByPickupWindow;

/**
 * Read orders (with their items) matching a WHERE clause on "Order" o.
 * Sorted by pickup window (earliest first), then order number.
 */
async function loadOrders(db, whereSql, params) {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS}
     FROM "Order" o
     LEFT JOIN payments p ON p.order_id = o."id"
     WHERE ${whereSql}
     ORDER BY o."pickupWindowStart", o."pickupWindowEnd", o."orderNumber"`,
    params,
  );
  if (rows.length === 0) return [];

  const items = await db.query(
    `SELECT "orderId", "menuItemId", "name", "unitPriceCents", "quantity"
     FROM "OrderItem"
     WHERE "orderId" = ANY($1::int[])
     ORDER BY "id"`,
    [rows.map((row) => row.id)],
  );
  const itemsByOrder = new Map();
  items.rows.forEach((item) => {
    if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
    itemsByOrder.get(item.orderId).push(item);
  });
  return rows.map((row) => toOrder(row, itemsByOrder.get(row.id) || []));
}

async function loadOrder(db, vendorId, orderId) {
  const [order] = await loadOrders(db, 'o."id" = $1 AND o."vendorId" = $2', [orderId, vendorId]);
  return order;
}

/**
 * The day to report on: the given YYYY-MM-DD, or today in Singapore.
 * @returns {Promise<string|undefined>} the day, or undefined if the vendor does not exist
 */
async function resolveDay(vendorId, date) {
  const { rows } = await pool.query(
    `SELECT to_char(COALESCE($2::date, (NOW() AT TIME ZONE '${TIME_ZONE}')::date), 'YYYY-MM-DD') AS "day"
     FROM "Vendor" WHERE "id" = $1`,
    [vendorId, date],
  );
  return rows[0] && rows[0].day;
}

const timeSg = new Intl.DateTimeFormat('en-SG', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});

/** "12:00 pm – 12:15 pm" in Singapore time */
function formatWindowSg(start, end) {
  return `${timeSg.format(start)} – ${timeSg.format(end)}`;
}

module.exports.formatWindowSg = formatWindowSg;

// Orders whose pickup window starts on day $2 (Singapore time)
const ON_DAY = `o."vendorId" = $1 AND (o."pickupWindowStart" AT TIME ZONE '${TIME_ZONE}')::date = $2::date`;

// ── Reading orders ───────────────────────────────────────

/**
 * A stall's orders for one day, grouped by pickup window, earliest window first.
 *
 * @param {number} vendorId
 * @param {string|null} date  YYYY-MM-DD, or null for today
 * @returns {Promise<{date: string, windows: object[]}|undefined>} undefined if no such vendor
 */
module.exports.listOrders = async function listOrders(vendorId, date) {
  const day = await resolveDay(vendorId, date);
  if (!day) return undefined;
  const orders = await loadOrders(pool, ON_DAY, [vendorId, day]);
  return { date: day, windows: groupByPickupWindow(orders) };
};

/** One order of this stall, by id. */
module.exports.getOrder = async function getOrder(vendorId, orderId) {
  return loadOrder(pool, vendorId, orderId);
};

/** One order of this stall, by the number the student shows. */
module.exports.getOrderByNumber = async function getOrderByNumber(vendorId, orderNumber) {
  const [order] = await loadOrders(pool, 'o."vendorId" = $1 AND o."orderNumber" = $2', [
    vendorId,
    orderNumber,
  ]);
  return order;
};

// ── Placing an order ─────────────────────────────────────

/**
 * Place a manual pickup order (the vendor demo / walk-up path). Students' real orders come
 * through the shared checkout path in schema.sql, which books a pickup window and records a
 * payment; a manual order has no customer account, pickup window or payment row, which the
 * shared schema allows.
 *
 * Runs the same basket rules as checkout validation, but with the
 * stall and item rows locked, then reduces "quantityLeft" (selling out at 0), gives the
 * order the stall's next number and saves it – all in one transaction, so two students
 * can't both buy the last one.
 *
 * @param {number} vendorId
 * @param {{customerName: string|null, pickupWindowStart: Date, pickupWindowEnd: Date,
 *          lines: {itemId: number, quantity: number}[]}} input
 * @returns {Promise<{order: object}|{problems: object[]}|undefined>} undefined if no such vendor
 */
module.exports.placeOrder = async function placeOrder(vendorId, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Locking the stall row also makes order numbers safe to hand out one by one
    const vendor = await client.query(
      'SELECT ("isOpen" AND "isActive") AS "isOpen" FROM "Vendor" WHERE "id" = $1 FOR UPDATE',
      [vendorId],
    );
    if (vendor.rows.length === 0) {
      await client.query('ROLLBACK');
      return undefined;
    }

    const menu = await client.query(
      `SELECT "id", "name", "priceCents", "quantityLeft", "isSoldOut"
       FROM "MenuItem"
       WHERE "vendorId" = $1 AND "id" = ANY($2::int[]) AND "deletedAt" IS NULL
       ORDER BY "id"
       FOR UPDATE`,
      [vendorId, input.lines.map((line) => line.itemId)],
    );
    // The stall row is locked, so the in-progress count can't change under us
    const rules = await loadOrderingRules(client, vendorId);
    const basket = checkBasket(vendor.rows[0].isOpen, input.lines, menu.rows, rules);
    if (!basket.ok) {
      await client.query('ROLLBACK');
      return { problems: basket.problems };
    }

    for (const line of basket.items) {
      await client.query(
        `UPDATE "MenuItem"
         SET "quantityLeft" = "quantityLeft" - $2,
             "isSoldOut" = "isSoldOut" OR "quantityLeft" - $2 = 0,
             "updatedAt" = NOW()
         WHERE "id" = $1 AND "quantityLeft" IS NOT NULL`,
        [line.itemId, line.quantity],
      );
    }

    const next = await client.query(
      'SELECT COALESCE(MAX("orderNumber"), 1000) + 1 AS "orderNumber" FROM "Order" WHERE "vendorId" = $1',
      [vendorId],
    );
    const inserted = await client.query(
      `INSERT INTO "Order" ("vendorId", "orderNumber", "customerName", "pickupWindowStart",
         "pickupWindowEnd", "totalCents")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING "id"`,
      [
        vendorId,
        next.rows[0].orderNumber,
        input.customerName,
        input.pickupWindowStart,
        input.pickupWindowEnd,
        basket.totalCents,
      ],
    );
    const orderId = inserted.rows[0].id;

    const values = [];
    const placeholders = basket.items.map((line, i) => {
      values.push(orderId, line.itemId, line.name, line.priceCents, line.quantity);
      const b = i * 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
    });
    await client.query(
      `INSERT INTO "OrderItem" ("orderId", "menuItemId", "name", "unitPriceCents", "quantity")
       VALUES ${placeholders.join(', ')}`,
      values,
    );

    const order = await loadOrder(client, vendorId, orderId);

    // In-app notifications the vendor has switched on (new order, sold out, low stock)
    const byId = new Map(menu.rows.map((row) => [row.id, row]));
    const stock = basket.items
      .filter((line) => byId.get(line.itemId).quantityLeft !== null)
      .map((line) => {
        const before = byId.get(line.itemId).quantityLeft;
        return { menuItemId: line.itemId, name: line.name, before, after: before - line.quantity };
      });
    const notes = notificationsForOrder(
      {
        id: order.id,
        orderNumber: order.orderNumber,
        totalCents: order.totalCents,
        itemCount: basket.items.reduce((sum, line) => sum + line.quantity, 0),
        windowLabel: formatWindowSg(order.pickupWindowStart, order.pickupWindowEnd),
      },
      stock,
      rules.notifications,
    );
    await createNotifications(client, vendorId, notes);

    await client.query('COMMIT');
    return { order };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ── Preparing and handing over ───────────────────────────

/**
 * Move an order one step forward: CONFIRMED → PREPARING, or PREPARING → READY.
 * Records the time of the step ("preparingAt" / "readyAt"). The single conditional
 * UPDATE means two clicks (or two devices) can't move it twice.
 *
 * @param {'PREPARING'|'READY'} nextStatus
 * @returns {Promise<{order: object}|{currentStatus: string}|undefined>}
 *          undefined if this stall has no such order; currentStatus if it can't move there
 */
module.exports.advanceOrder = async function advanceOrder(vendorId, orderId, nextStatus) {
  const column = STEP_TIMESTAMP[nextStatus];
  const updated = await pool.query(
    `UPDATE "Order" SET "status" = $3, "${column}" = NOW()
     WHERE "id" = $1 AND "vendorId" = $2 AND "status" = $4
     RETURNING "id"`,
    [orderId, vendorId, nextStatus, PREVIOUS_STATUS[nextStatus]],
  );
  if (updated.rows.length === 0) {
    const current = await pool.query(
      'SELECT "status" FROM "Order" WHERE "id" = $1 AND "vendorId" = $2',
      [orderId, vendorId],
    );
    return current.rows[0] ? { currentStatus: current.rows[0].status } : undefined;
  }
  return { order: await loadOrder(pool, vendorId, orderId) };
};

/**
 * Mark a Ready order Collected, after the vendor has checked the order number, taken
 * payment and handed over the food. Only a READY order of this stall whose number
 * matches can be collected. The collection time is recorded once: a second attempt
 * changes nothing (and the "Order_enforce_status_transition" trigger backs this up).
 *
 * The same statement writes the handover to the shared "collections" table, recorded
 * against the stall owner's account ("Vendor"."ownerUserId"). Stalls without an owner
 * account (the demo stalls) have nobody to record it against, so only "Order" changes.
 *
 * @param {number} orderNumber  the number the vendor checked against the student's
 * @returns {Promise<{order}|{alreadyCollected: object}|{notReady: string}|{numberMismatch: number}|undefined>}
 */
module.exports.collectOrder = async function collectOrder(vendorId, orderId, orderNumber) {
  const updated = await pool.query(
    `WITH done AS (
       UPDATE "Order" SET "status" = 'COLLECTED', "collectedAt" = NOW()
       WHERE "id" = $1 AND "vendorId" = $2 AND "status" = 'READY' AND "orderNumber" = $3
       RETURNING "id", "vendorId"
     ), handover AS (
       INSERT INTO collections (order_id, collected_by)
       SELECT done."id", v."ownerUserId"
       FROM done JOIN "Vendor" v ON v."id" = done."vendorId"
       WHERE v."ownerUserId" IS NOT NULL
       ON CONFLICT (order_id) DO NOTHING
     )
     SELECT "id" FROM done`,
    [orderId, vendorId, orderNumber],
  );
  if (updated.rows.length > 0) return { order: await loadOrder(pool, vendorId, orderId) };

  const order = await loadOrder(pool, vendorId, orderId);
  if (!order) return undefined;
  if (order.status === 'COLLECTED') return { alreadyCollected: order };
  if (order.status !== 'READY') return { notReady: order.status };
  return { numberMismatch: order.orderNumber };
};

// ── Dashboard figures ────────────────────────────────────

/**
 * The figures behind the dashboard charts, for one day (Singapore time).
 * counts.total includes cancelled orders (it is the sum of the status counts); the
 * pickup-window, top-item and last-7-days charts leave cancelled orders out.
 * toCollectCents is the money still to take at the counter: Ready orders not paid online.
 *
 * @returns {Promise<object|undefined>} undefined if the vendor does not exist
 */
module.exports.getOrderStats = async function getOrderStats(vendorId, date) {
  const day = await resolveDay(vendorId, date);
  if (!day) return undefined;
  const params = [vendorId, day];

  const [totals, windows, topItems, week] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS "total",
         COUNT(*) FILTER (WHERE o."status" = 'CONFIRMED')::int AS "confirmed",
         COUNT(*) FILTER (WHERE o."status" = 'PREPARING')::int AS "preparing",
         COUNT(*) FILTER (WHERE o."status" = 'READY')::int AS "ready",
         COUNT(*) FILTER (WHERE o."status" = 'COLLECTED')::int AS "collected",
         COUNT(*) FILTER (WHERE o."status" = 'CANCELLED')::int AS "cancelled",
         COALESCE(SUM(o."totalCents") FILTER (WHERE o."status" = 'COLLECTED'), 0)::int AS "collectedCents",
         COALESCE(SUM(o."totalCents") FILTER (
           WHERE o."status" = 'READY' AND p.payment_status IS DISTINCT FROM 'PAID'
         ), 0)::int AS "toCollectCents",
         COUNT(*) FILTER (WHERE o."readyAt" <= o."pickupWindowEnd")::int AS "onTime",
         COUNT(*) FILTER (WHERE o."readyAt" > o."pickupWindowEnd")::int AS "late"
       FROM "Order" o
       LEFT JOIN payments p ON p.order_id = o."id"
       WHERE ${ON_DAY}`,
      params,
    ),
    pool.query(
      `SELECT o."pickupWindowStart" AS "start", o."pickupWindowEnd" AS "end", COUNT(*)::int AS "orders"
       FROM "Order" o WHERE ${ON_DAY} AND ${NOT_CANCELLED}
       GROUP BY 1, 2 ORDER BY 1, 2`,
      params,
    ),
    pool.query(
      `SELECT i."name", SUM(i."quantity")::int AS "quantity"
       FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
       WHERE ${ON_DAY} AND ${NOT_CANCELLED}
       GROUP BY i."name" ORDER BY 2 DESC, 1 LIMIT 5`,
      params,
    ),
    pool.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS "date",
              COUNT(o."id")::int AS "orders",
              COALESCE(SUM(o."totalCents") FILTER (WHERE o."status" = 'COLLECTED'), 0)::int AS "collectedCents"
       FROM generate_series($2::date - 6, $2::date, interval '1 day') AS d(day)
       LEFT JOIN "Order" o
         ON o."vendorId" = $1
        AND (o."pickupWindowStart" AT TIME ZONE '${TIME_ZONE}')::date = d.day::date
        AND ${NOT_CANCELLED}
       GROUP BY d.day ORDER BY d.day`,
      params,
    ),
  ]);

  const t = totals.rows[0];
  const readyCount = t.onTime + t.late;
  return {
    date: day,
    counts: {
      total: t.total,
      CONFIRMED: t.confirmed,
      PREPARING: t.preparing,
      READY: t.ready,
      COLLECTED: t.collected,
      CANCELLED: t.cancelled,
    },
    collectedCents: t.collectedCents,
    toCollectCents: t.toCollectCents,
    readyOnTime: {
      onTime: t.onTime,
      late: t.late,
      rate: readyCount === 0 ? null : t.onTime / readyCount,
    },
    byWindow: windows.rows,
    topItems: topItems.rows,
    last7Days: week.rows,
  };
};
