const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/models/db');
const { deleteVendors } = require('../helpers/cleanup');

// ── DB Setup / Teardown ──────────────────────────────────
// Each test starts with two vendors of its own: an open stall with three menu items
// (one with only 3 left), and a second stall. Orders are placed through the API.
// Integration test files run one at a time (--runInBand).

const EMAILS = ['orders-a@makanliao.sg', 'orders-b@makanliao.sg'];
// Accounts some tests create: a stall owner and a customer who checks out
const PERSON_EMAILS = ['orders-owner@makanliao.sg', 'orders-customer@makanliao.sg'];
let vendorId;
let otherVendorId;
let laksaId; // $5.50, not counting
let meeId; // $4.50, 3 left
let otahId; // $1.50, sold out

const MINUTE = 60000;
const iso = (offsetMinutes) => new Date(Date.now() + offsetMinutes * MINUTE).toISOString();
// A window that starts now: always today in Singapore, whatever time the tests run
const windowNow = () => ({ pickupWindowStart: iso(0), pickupWindowEnd: iso(15) });

async function insertVendor(email, stallName, isOpen) {
  const { rows } = await pool.query(
    'INSERT INTO "Vendor" ("email", "stallName", "isOpen") VALUES ($1, $2, $3) RETURNING "id"',
    [email, stallName, isOpen],
  );
  return rows[0].id;
}

async function insertItem(vid, name, priceCents, quantityLeft, isSoldOut) {
  const { rows } = await pool.query(
    `INSERT INTO "MenuItem" ("vendorId", "name", "priceCents", "quantityLeft", "isSoldOut")
     VALUES ($1, $2, $3, $4, $5) RETURNING "id"`,
    [vid, name, priceCents, quantityLeft, isSoldOut],
  );
  return rows[0].id;
}

beforeEach(async () => {
  await deleteVendors(pool, 'v."email" = ANY($1)', [EMAILS]);
  vendorId = await insertVendor(EMAILS[0], 'Orders Test Laksa', true);
  otherVendorId = await insertVendor(EMAILS[1], 'Orders Test Kopi', true);
  laksaId = await insertItem(vendorId, 'Curry Laksa', 550, null, false);
  meeId = await insertItem(vendorId, 'Mee Siam', 450, 3, false);
  otahId = await insertItem(vendorId, 'Otah', 150, null, true);
});

afterAll(async () => {
  await deleteVendors(pool, 'v."email" = ANY($1)', [EMAILS]);
  await pool.query('DELETE FROM "Person" WHERE "email" = ANY($1)', [PERSON_EMAILS]);
  await pool.end();
});

// ── Helpers ──────────────────────────────────────────────
const base = (vid = vendorId) => `/vendors/${vid}/orders`;

async function place(items, extra = {}, vid = vendorId) {
  return request(app)
    .post(base(vid))
    .send({ customerName: 'Alice', ...windowNow(), items, ...extra });
}

async function placeOk(items = [{ itemId: laksaId, quantity: 1 }], extra = {}) {
  const res = await place(items, extra);
  expect(res.status).toBe(201);
  return res.body;
}

const advance = (id, status, vid = vendorId) =>
  request(app)
    .patch(`${base(vid)}/${id}/status`)
    .send({ status });

async function readyOrder(items) {
  const order = await placeOk(items);
  await advance(order.id, 'PREPARING');
  const res = await advance(order.id, 'READY');
  return res.body;
}

const collect = (order, overrides = {}, vid = vendorId) =>
  request(app)
    .post(`${base(vid)}/${order.id}/collect`)
    .send({
      orderNumber: order.orderNumber,
      paymentReceived: true,
      foodHandedOver: true,
      ...overrides,
    });

async function dbOrder(id) {
  const { rows } = await pool.query('SELECT * FROM "Order" WHERE "id" = $1', [id]);
  return rows[0];
}

async function quantityLeft(itemId) {
  const { rows } = await pool.query(
    'SELECT "quantityLeft", "isSoldOut" FROM "MenuItem" WHERE "id" = $1',
    [itemId],
  );
  return rows[0];
}

// ─────────────────────────────────────────────────────────
// POST /vendors/:vendorId/orders (placing an order)
// ─────────────────────────────────────────────────────────
describe('POST /vendors/:vendorId/orders', () => {
  // Valid partition: saved as Confirmed with item snapshots and the total to collect
  test('should place an order', async () => {
    const res = await place([
      { itemId: laksaId, quantity: 2 },
      { itemId: meeId, quantity: 1 },
    ]);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      vendorId,
      orderNumber: 1001,
      customerName: 'Alice',
      status: 'CONFIRMED',
      totalCents: 1550,
      readyAt: null,
      readyOnTime: null,
    });
    expect(res.body.items).toEqual([
      {
        menuItemId: laksaId,
        name: 'Curry Laksa',
        unitPriceCents: 550,
        quantity: 2,
        lineTotalCents: 1100,
      },
      {
        menuItemId: meeId,
        name: 'Mee Siam',
        unitPriceCents: 450,
        quantity: 1,
        lineTotalCents: 450,
      },
    ]);
  });

  // Valid partition: order numbers go up one at a time per stall
  test('should number orders per stall', async () => {
    const first = await placeOk();
    const second = await placeOk();
    const other = await insertItem(otherVendorId, 'Kopi', 150, null, false);
    const elsewhere = await place([{ itemId: other, quantity: 1 }], {}, otherVendorId);

    expect([first.orderNumber, second.orderNumber]).toEqual([1001, 1002]);
    expect(elsewhere.body.orderNumber).toBe(1001);
  });

  // Boundary: buying the last ones sells the item out; one more is refused
  test('should sell out an item when the last ones are ordered (boundary)', async () => {
    await placeOk([{ itemId: meeId, quantity: 3 }]);
    expect(await quantityLeft(meeId)).toEqual({ quantityLeft: 0, isSoldOut: true });

    const more = await place([{ itemId: meeId, quantity: 1 }]);
    expect(more.status).toBe(409);
    expect(more.body.problems[0].code).toBe('SOLD_OUT');
  });

  // Error handling: not enough left → nothing saved, nothing reduced
  test('should refuse more than are left and change nothing', async () => {
    const res = await place([
      { itemId: laksaId, quantity: 1 },
      { itemId: meeId, quantity: 4 },
    ]);

    expect(res.status).toBe(409);
    expect(res.body.problems).toEqual([
      { itemId: meeId, code: 'NOT_ENOUGH', message: 'Only 3 Mee Siam left', quantityLeft: 3 },
    ]);
    expect((await quantityLeft(meeId)).quantityLeft).toBe(3);
    const { rows } = await pool.query('SELECT 1 FROM "Order" WHERE "vendorId" = $1', [vendorId]);
    expect(rows).toHaveLength(0);
  });

  // Concurrency: two students racing for the last ones – only one wins
  test('should not oversell when two orders arrive at once', async () => {
    const results = await Promise.all([
      place([{ itemId: meeId, quantity: 2 }]),
      place([{ itemId: meeId, quantity: 2 }]),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await quantityLeft(meeId)).quantityLeft).toBe(1);
  });

  test.each([
    ['sold out', () => [{ itemId: otahId, quantity: 1 }], 'SOLD_OUT'],
    ['another stall', () => [{ itemId: 999999, quantity: 1 }], 'NOT_FOUND'],
  ])('should refuse an item that is %s', async (_label, items, code) => {
    const res = await place(items());
    expect(res.body.problems[0].code).toBe(code);
  });

  test('should refuse orders while the stall is closed', async () => {
    await pool.query('UPDATE "Vendor" SET "isOpen" = FALSE WHERE "id" = $1', [vendorId]);
    const res = await place([{ itemId: laksaId, quantity: 1 }]);
    expect(res.body.problems[0].code).toBe('STALL_CLOSED');
  });

  test.each([
    [{ pickupWindowStart: iso(0), pickupWindowEnd: iso(4) }, /5 to 120 minutes/],
    [{ items: [] }, /at least one item/],
    [{ customerName: '<script>' }, /not allowed/],
  ])('should return 400 for %p', async (change, message) => {
    const res = await place([{ itemId: laksaId, quantity: 1 }], change);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  test('should return 404 for an unknown vendor', async () => {
    const res = await place([{ itemId: laksaId, quantity: 1 }], {}, 999999);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// GET /vendors/:vendorId/orders (preparation dashboard)
// ─────────────────────────────────────────────────────────
describe('GET /vendors/:vendorId/orders', () => {
  // Valid partition: grouped by pickup window, earliest window first
  test('should group orders by pickup window, earliest first', async () => {
    // Fixed times, worked out once, so "the same window" really is the same
    const early = { pickupWindowStart: iso(0), pickupWindowEnd: iso(15) };
    const later = { pickupWindowStart: iso(1), pickupWindowEnd: iso(16) };
    const laterOrder = await placeOk(undefined, later); // placed first, but a later window
    const early1 = await placeOk(undefined, early);
    const early2 = await placeOk(undefined, early);

    const res = await request(app).get(base());

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.windows.map((w) => w.orders.map((o) => o.orderNumber))).toEqual([
      [early1.orderNumber, early2.orderNumber],
      [laterOrder.orderNumber],
    ]);
    expect(res.body.windows[0]).toMatchObject({
      start: early.pickupWindowStart,
      end: early.pickupWindowEnd,
    });
  });

  // Valid partition: each order shows number, items, quantities and status
  test('should show number, items, quantities and status', async () => {
    await placeOk([{ itemId: laksaId, quantity: 2 }]);
    const res = await request(app).get(base());
    expect(res.body.windows[0].orders[0]).toMatchObject({
      orderNumber: 1001,
      status: 'CONFIRMED',
      items: [{ name: 'Curry Laksa', quantity: 2 }],
    });
  });

  // Boundary: a day with no orders
  test('should return no windows for a day without orders', async () => {
    const res = await request(app).get(`${base()}?date=2020-01-01`);
    expect(res.body).toEqual({ date: '2020-01-01', windows: [] });
  });

  test("should not include another stall's orders", async () => {
    await placeOk();
    const res = await request(app).get(base(otherVendorId));
    expect(res.body.windows).toEqual([]);
  });

  test('should return 400 for a bad date and 404 for an unknown vendor', async () => {
    expect((await request(app).get(`${base()}?date=2026-02-30`)).status).toBe(400);
    expect((await request(app).get(base(999999))).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// PATCH /vendors/:vendorId/orders/:orderId/status
// ─────────────────────────────────────────────────────────
describe('PATCH /vendors/:vendorId/orders/:orderId/status', () => {
  // Valid partition: Confirmed → Preparing → Ready, recording each time
  test('should move an order through Preparing to Ready and record the times', async () => {
    const order = await placeOk();

    const preparing = await advance(order.id, 'PREPARING');
    expect(preparing.status).toBe(200);
    expect(preparing.body.status).toBe('PREPARING');
    expect(preparing.body.preparingAt).not.toBeNull();

    const ready = await advance(order.id, 'READY');
    expect(ready.body.status).toBe('READY');
    expect(ready.body.readyAt).not.toBeNull();
    // Window ends 15 minutes from now, so it was ready on time
    expect(ready.body.readyOnTime).toBe(true);
  });

  // Error handling: can't skip Preparing, go backwards, or repeat a step
  test('should not skip straight from Confirmed to Ready', async () => {
    const order = await placeOk();
    const res = await advance(order.id, 'READY');
    expect(res.status).toBe(409);
    expect((await dbOrder(order.id)).status).toBe('CONFIRMED');
  });

  test('should not move a Ready order back to Preparing', async () => {
    const order = await readyOrder();
    const res = await advance(order.id, 'PREPARING');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/is Ready/);
  });

  test('should only record the first of two quick clicks', async () => {
    const order = await placeOk();
    const [a, b] = await Promise.all([
      advance(order.id, 'PREPARING'),
      advance(order.id, 'PREPARING'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  test("should return 404 for another stall's order", async () => {
    const order = await placeOk();
    const res = await advance(order.id, 'PREPARING', otherVendorId);
    expect(res.status).toBe(404);
  });

  test('should return 400 for an unknown status', async () => {
    const order = await placeOk();
    expect((await advance(order.id, 'COLLECTED')).status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────
// Ready on time (recorded so the team can check it)
// ─────────────────────────────────────────────────────────
describe('Ready on time', () => {
  // Boundary: ready after the window ended is reported late
  test('should report an order made ready after its window as late', async () => {
    const order = await placeOk(undefined, {
      pickupWindowStart: iso(-30),
      pickupWindowEnd: iso(-15),
    });
    await advance(order.id, 'PREPARING');

    const ready = await advance(order.id, 'READY');

    expect(ready.body.readyOnTime).toBe(false);
    const row = await dbOrder(order.id);
    expect(row.readyAt > row.pickupWindowEnd).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// Find by number
// ─────────────────────────────────────────────────────────
describe('GET /vendors/:vendorId/orders/number/:orderNumber', () => {
  test('should find a ready order by its number', async () => {
    const order = await readyOrder([{ itemId: meeId, quantity: 2 }]);

    const res = await request(app).get(`${base()}/number/${order.orderNumber}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: order.id, status: 'READY', totalCents: 900 });
    expect(res.body.items).toEqual([expect.objectContaining({ name: 'Mee Siam', quantity: 2 })]);
  });

  test("should not find another stall's order by number", async () => {
    const order = await placeOk();
    const res = await request(app).get(`${base(otherVendorId)}/number/${order.orderNumber}`);
    expect(res.status).toBe(404);
  });

  test('should return the order by id too', async () => {
    const order = await placeOk();
    const res = await request(app).get(`${base()}/${order.id}`);
    expect(res.body.orderNumber).toBe(order.orderNumber);
  });
});

// ─────────────────────────────────────────────────────────
// POST /vendors/:vendorId/orders/:orderId/collect
// ─────────────────────────────────────────────────────────
describe('POST /vendors/:vendorId/orders/:orderId/collect', () => {
  // Valid partition: ready, number checked, paid, handed over → collected with a time
  test('should mark a ready order collected and record the time', async () => {
    const order = await readyOrder();

    const res = await collect(order);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COLLECTED');
    expect(res.body.collectedAt).not.toBeNull();
  });

  // Error handling: a second collection changes nothing
  test('should refuse a second collection and keep the first time', async () => {
    const order = await readyOrder();
    await collect(order);
    const first = (await dbOrder(order.id)).collectedAt;

    const again = await collect(order);

    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already collected at/);
    expect((await dbOrder(order.id)).collectedAt).toEqual(first);
  });

  test('should let only one of two simultaneous collections through', async () => {
    const order = await readyOrder();
    const [a, b] = await Promise.all([collect(order), collect(order)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  test.each(['CONFIRMED', 'PREPARING'])('should refuse to collect a %s order', async (status) => {
    const order = await placeOk();
    if (status === 'PREPARING') await advance(order.id, 'PREPARING');
    const res = await collect(order);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Only Ready orders/);
  });

  test('should refuse when the checked number does not match', async () => {
    const order = await readyOrder();
    const res = await collect(order, { orderNumber: order.orderNumber + 1 });
    expect(res.status).toBe(409);
    expect((await dbOrder(order.id)).status).toBe('READY');
  });

  test("should refuse to collect another stall's order", async () => {
    const order = await readyOrder();
    const res = await collect(order, {}, otherVendorId);
    expect(res.status).toBe(404);
    expect((await dbOrder(order.id)).status).toBe('READY');
  });

  test.each([{ paymentReceived: false }, { foodHandedOver: false }])(
    'should return 400 without the handover checks %p',
    async (change) => {
      const order = await readyOrder();
      const res = await collect(order, change);
      expect(res.status).toBe(400);
    },
  );
});

// ─────────────────────────────────────────────────────────
// GET /vendors/:vendorId/orders/stats
// ─────────────────────────────────────────────────────────
describe('GET /vendors/:vendorId/orders/stats', () => {
  test('should count orders, money and readiness for today', async () => {
    await placeOk([{ itemId: laksaId, quantity: 2 }]); // confirmed, $11.00
    const ready = await readyOrder([{ itemId: meeId, quantity: 1 }]); // ready, $4.50
    const done = await readyOrder([{ itemId: laksaId, quantity: 1 }]); // collected, $5.50
    await collect(done);

    const res = await request(app).get(`${base()}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({
      total: 3,
      CONFIRMED: 1,
      PREPARING: 0,
      READY: 1,
      COLLECTED: 1,
      CANCELLED: 0,
    });
    expect(res.body.collectedCents).toBe(550);
    expect(res.body.toCollectCents).toBe(ready.totalCents);
    expect(res.body.readyOnTime).toEqual({ onTime: 2, late: 0, rate: 1 });
    expect(res.body.topItems[0]).toEqual({ name: 'Curry Laksa', quantity: 3 });
    expect(res.body.last7Days).toHaveLength(7);
    expect(res.body.last7Days.at(-1)).toEqual({
      date: res.body.date,
      orders: 3,
      collectedCents: 550,
    });
  });

  test('should return zeros and a null rate for a quiet day (boundary)', async () => {
    const res = await request(app).get(`${base()}/stats?date=2020-01-01`);
    expect(res.body.counts.total).toBe(0);
    expect(res.body.readyOnTime.rate).toBeNull();
    expect(res.body.byWindow).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────
// Shared schema: cancelled orders, checkout orders, payments and collection records
// ─────────────────────────────────────────────────────────
describe('Shared order flow', () => {
  async function person(email, name, role) {
    await pool.query('DELETE FROM "Person" WHERE "email" = $1', [email]);
    const { rows } = await pool.query(
      'INSERT INTO "Person" ("email", "name", "role") VALUES ($1, $2, $3) RETURNING "id"',
      [email, name, role],
    );
    return rows[0].id;
  }

  // The customer branch cancels through the shared table (allowed before READY)
  async function cancel(order) {
    await pool.query(
      `UPDATE "Order" SET "status" = 'CANCELLED', "cancelledAt" = NOW() WHERE "id" = $1`,
      [order.id],
    );
  }

  // A real checkout through the customer branch's "orders" / "order_items" views.
  // One transaction, like the real checkout: the shared schema checks at COMMIT that a
  // customer order has items adding up to its total.
  async function checkout(customerId) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const orderId = await checkoutRows(db, customerId);
      await db.query('COMMIT');
      return orderId;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function checkoutRows(db, customerId) {
    const start = new Date(Date.now() + 5 * MINUTE);
    const { rows: windows } = await db.query(
      `INSERT INTO "PickupWindow" ("stallId", "startTime", "endTime", "maxOrders", "bookedCount")
       VALUES ($1, $2, $3, 10, 1) RETURNING "id"`,
      [vendorId, start, new Date(start.getTime() + 15 * MINUTE)],
    );
    const { rows } = await db.query(
      `INSERT INTO orders (customer_id, stall_id, pickup_window_id, collection_reference, total_amount)
       VALUES ($1, $2, $3, 'ORD-TEST-1', 11.00) RETURNING order_id`,
      [customerId, vendorId, windows[0].id],
    );
    const orderId = rows[0].order_id;
    await db.query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, subtotal)
       VALUES ($1, $2, 2, 5.50, 11.00)`,
      [orderId, laksaId],
    );
    await db.query(
      `INSERT INTO payments (order_id, amount, payment_status, payment_method, paid_at)
       VALUES ($1, 11.00, 'PAID', 'PAYNOW', NOW())`,
      [orderId],
    );
    return orderId;
  }

  test('should show a cancelled order on the board but leave it out of the charts', async () => {
    const kept = await placeOk([{ itemId: laksaId, quantity: 1 }]);
    const dropped = await placeOk([{ itemId: meeId, quantity: 1 }]);
    await cancel(dropped);

    const list = await request(app).get(base());
    const orders = list.body.windows.flatMap((w) => w.orders);
    const shown = orders.find((o) => o.id === dropped.id);
    expect(shown.status).toBe('CANCELLED');
    expect(shown.cancelledAt).not.toBeNull();

    const stats = await request(app).get(`${base()}/stats`);
    expect(stats.body.counts).toMatchObject({ total: 2, CONFIRMED: 1, CANCELLED: 1 });
    expect(stats.body.byWindow.reduce((sum, w) => sum + w.orders, 0)).toBe(1);
    expect(stats.body.topItems).toEqual([{ name: 'Curry Laksa', quantity: 1 }]);
    expect(stats.body.last7Days.at(-1).orders).toBe(1);
    expect(orders.find((o) => o.id === kept.id).status).toBe('CONFIRMED');
  });

  test('should not let a cancelled order move on or be collected', async () => {
    const order = await placeOk();
    await cancel(order);

    const moved = await advance(order.id, 'PREPARING');
    expect(moved.status).toBe(409);
    expect(moved.body.error).toMatch(/Cancelled/);

    const collected = await collect(order);
    expect(collected.status).toBe(409);
    expect(collected.body.error).toMatch(/Cancelled/);
  });

  test('should show a checkout order with its customer, reference and payment', async () => {
    const customerId = await person(PERSON_EMAILS[1], 'Checkout Student', 'customer');
    const orderId = await checkout(customerId);

    const res = await request(app).get(`${base()}/${orderId}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      customerId,
      customerName: 'Checkout Student',
      collectionReference: 'ORD-TEST-1',
      status: 'CONFIRMED',
      totalCents: 1100,
      payment: { status: 'PAID', method: 'PAYNOW' },
      items: [{ menuItemId: laksaId, name: 'Curry Laksa', quantity: 2, unitPriceCents: 550 }],
    });
    expect(res.body.pickupWindowId).toEqual(expect.any(Number));
  });

  test('should not count a Ready order paid online as money to collect', async () => {
    const customerId = await person(PERSON_EMAILS[1], 'Checkout Student', 'customer');
    const orderId = await checkout(customerId);
    await advance(orderId, 'PREPARING');
    expect((await advance(orderId, 'READY')).status).toBe(200);
    const cash = await readyOrder([{ itemId: meeId, quantity: 1 }]); // pays at the stall

    const stats = await request(app).get(`${base()}/stats`);

    expect(stats.body.counts.READY).toBe(2);
    expect(stats.body.toCollectCents).toBe(cash.totalCents);
  });

  test('should give manual orders no customer, window or payment', async () => {
    const order = await placeOk();
    expect(order).toMatchObject({
      customerId: null,
      pickupWindowId: null,
      collectionReference: null,
      payment: null,
    });
  });

  test('should record the handover against the stall owner', async () => {
    const ownerId = await person(PERSON_EMAILS[0], 'Orders Owner', 'vendor');
    await pool.query('UPDATE "Vendor" SET "ownerUserId" = $1 WHERE "id" = $2', [ownerId, vendorId]);
    const order = await readyOrder();

    expect((await collect(order)).status).toBe(200);
    expect((await collect(order)).status).toBe(409);

    const { rows } = await pool.query('SELECT * FROM collections WHERE order_id = $1', [order.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].collected_by).toBe(ownerId);
  });

  test('should collect without a handover record when the owner is not an active vendor', async () => {
    const ownerId = await person(PERSON_EMAILS[0], 'Orders Owner', 'customer');
    await pool.query('UPDATE "Vendor" SET "ownerUserId" = $1 WHERE "id" = $2', [ownerId, vendorId]);
    const order = await readyOrder();

    expect((await collect(order)).status).toBe(200);

    const { rows } = await pool.query('SELECT * FROM collections WHERE order_id = $1', [order.id]);
    expect(rows).toHaveLength(0);
    const status = await request(app).get(`${base()}/${order.id}`);
    expect(status.body.status).toBe('COLLECTED');
  });

  test('should collect without a handover record when the stall has no owner account', async () => {
    const order = await readyOrder();
    expect((await collect(order)).status).toBe(200);
    const { rows } = await pool.query('SELECT * FROM collections WHERE order_id = $1', [order.id]);
    expect(rows).toHaveLength(0);
  });

  test('should refuse orders while an admin has deactivated the stall', async () => {
    await pool.query('UPDATE "Vendor" SET "isActive" = FALSE WHERE "id" = $1', [vendorId]);
    const res = await place([{ itemId: laksaId, quantity: 1 }]);
    expect(res.status).toBe(409);
    expect(res.body.problems.map((p) => p.code)).toContain('STALL_CLOSED');
  });
});

// ─────────────────────────────────────────────────────────
// Database rules (safety net under the API)
// ─────────────────────────────────────────────────────────
describe('Order table rules', () => {
  // The trigger stops any change to a collected order, even straight SQL
  test('should refuse to change a collected order', async () => {
    const order = await readyOrder();
    await collect(order);
    await expect(
      pool.query('UPDATE "Order" SET "collectedAt" = NOW() WHERE "id" = $1', [order.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  // A Ready order must have a ready time
  test('should refuse a Ready order without a ready time', async () => {
    const order = await placeOk();
    await expect(
      pool.query(`UPDATE "Order" SET "status" = 'READY' WHERE "id" = $1`, [order.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
