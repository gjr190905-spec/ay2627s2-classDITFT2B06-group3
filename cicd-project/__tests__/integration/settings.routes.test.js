const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/models/db');
const { deleteVendors } = require('../helpers/cleanup');

// ── DB Setup / Teardown ──────────────────────────────────
// Each test starts with two open stalls of its own; the first has two menu items
// (Kopi not counted, Kaya Toast with 6 left). Integration files run one at a time.

const EMAILS = ['settings-a@makanliao.sg', 'settings-b@makanliao.sg'];
let vendorId;
let otherVendorId;
let kopiId;
let toastId;

const MINUTE = 60000;
const iso = (m) => new Date(Date.now() + m * MINUTE).toISOString();

async function insertVendor(email, stallName) {
  const { rows } = await pool.query(
    'INSERT INTO "Vendor" ("email", "stallName", "isOpen") VALUES ($1, $2, TRUE) RETURNING "id"',
    [email, stallName],
  );
  return rows[0].id;
}

async function insertItem(vid, name, priceCents, quantityLeft) {
  const { rows } = await pool.query(
    `INSERT INTO "MenuItem" ("vendorId", "name", "priceCents", "quantityLeft")
     VALUES ($1, $2, $3, $4) RETURNING "id"`,
    [vid, name, priceCents, quantityLeft],
  );
  return rows[0].id;
}

beforeEach(async () => {
  await deleteVendors(pool, 'v."email" = ANY($1)', [EMAILS]);
  vendorId = await insertVendor(EMAILS[0], 'Settings Test Kopi');
  otherVendorId = await insertVendor(EMAILS[1], 'Settings Test Other');
  kopiId = await insertItem(vendorId, 'Kopi', 150, null);
  toastId = await insertItem(vendorId, 'Kaya Toast', 380, 6);
});

afterAll(async () => {
  await deleteVendors(pool, 'v."email" = ANY($1)', [EMAILS]);
  await pool.end();
});

// ── Helpers ──────────────────────────────────────────────
const settingsUrl = (vid = vendorId) => `/vendors/${vid}/settings`;
const notesUrl = (vid = vendorId) => `/vendors/${vid}/notifications`;

const settings = (overrides = {}, notify = {}) => ({
  maxActiveOrders: null,
  notifications: {
    newOrder: true,
    soldOut: true,
    lowStock: true,
    lowStockThreshold: 3,
    ...notify,
  },
  ...overrides,
});

const save = (body, vid = vendorId) => request(app).put(settingsUrl(vid)).send(body);

const order = (items = [{ itemId: kopiId, quantity: 1 }]) =>
  request(app)
    .post(`/vendors/${vendorId}/orders`)
    .send({ pickupWindowStart: iso(0), pickupWindowEnd: iso(15), items });

const advance = (id, status) =>
  request(app).patch(`/vendors/${vendorId}/orders/${id}/status`).send({ status });

const notes = async (vid = vendorId) => (await request(app).get(notesUrl(vid))).body;

// ─────────────────────────────────────────────────────────
// GET / PUT /vendors/:vendorId/settings
// ─────────────────────────────────────────────────────────
describe('GET /vendors/:vendorId/settings', () => {
  // Boundary: a vendor who never saved gets the defaults
  test('should return the defaults before anything is saved', async () => {
    const res = await request(app).get(settingsUrl());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...settings(), activeOrders: 0 });
  });

  test('should count Confirmed and Preparing orders as in progress', async () => {
    const a = (await order()).body;
    const b = (await order()).body;
    await order();
    await advance(a.id, 'PREPARING');
    await advance(b.id, 'PREPARING');
    await advance(b.id, 'READY');

    const res = await request(app).get(settingsUrl());
    expect(res.body.activeOrders).toBe(2);
  });

  test('should return 404 for an unknown vendor and 400 for a bad id', async () => {
    expect((await request(app).get(settingsUrl(999999))).status).toBe(404);
    expect((await request(app).get('/vendors/abc/settings')).status).toBe(400);
  });
});

describe('PUT /vendors/:vendorId/settings', () => {
  // Valid partition: save, then read back
  test('should save the settings', async () => {
    const body = settings({ maxActiveOrders: 8 }, { newOrder: false, lowStockThreshold: 5 });

    const res = await save(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...body, activeOrders: 0 });
    expect((await request(app).get(settingsUrl())).body).toEqual({ ...body, activeOrders: 0 });
  });

  // Valid partition: a limit can be removed again any time
  test('should switch back to no limit', async () => {
    await save(settings({ maxActiveOrders: 8 }));
    const res = await save(settings({ maxActiveOrders: null }));
    expect(res.body.maxActiveOrders).toBeNull();
  });

  test("should not change another stall's settings", async () => {
    await save(settings({ maxActiveOrders: 2 }));
    expect((await request(app).get(settingsUrl(otherVendorId))).body.maxActiveOrders).toBeNull();
  });

  test.each([
    [settings({ maxActiveOrders: 0 }), /maxActiveOrders/],
    [settings({ maxActiveOrders: 201 }), /maxActiveOrders/],
    [settings({}, { lowStockThreshold: 51 }), /lowStockThreshold/],
    [settings({}, { soldOut: 'yes' }), /soldOut/],
    [{ maxActiveOrders: 5 }, /notifications/],
  ])('should return 400 for %p', async (body, message) => {
    const res = await save(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  test('should return 404 for an unknown vendor', async () => {
    expect((await save(settings(), 999999)).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// Orders at once (the limit applied to ordering)
// ─────────────────────────────────────────────────────────
describe('Order limit', () => {
  // Boundary: the limit-th order is accepted, the next is refused
  test('should accept orders up to the limit and refuse the next', async () => {
    await save(settings({ maxActiveOrders: 2 }));

    expect((await order()).status).toBe(201);
    expect((await order()).status).toBe(201);
    const third = await order();

    expect(third.status).toBe(409);
    expect(third.body.problems).toEqual([
      expect.objectContaining({ itemId: null, code: 'STALL_BUSY' }),
    ]);
  });

  // The checkout check gives the same answer, so students hear before paying
  test('should refuse at checkout check when full', async () => {
    await save(settings({ maxActiveOrders: 1 }));
    await order();
    const res = await request(app)
      .post(`/vendors/${vendorId}/menu/checkout-check`)
      .send({ items: [{ itemId: kopiId, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.problems[0].code).toBe('STALL_BUSY');
  });

  // Valid partition: marking an order Ready frees a place
  test('should take orders again once one is marked Ready', async () => {
    await save(settings({ maxActiveOrders: 1 }));
    const first = (await order()).body;
    expect((await order()).status).toBe(409);

    await advance(first.id, 'PREPARING');
    expect((await order()).status).toBe(409); // Preparing still counts
    await advance(first.id, 'READY');

    expect((await order()).status).toBe(201);
  });

  // Valid partition: lowering the limit below the current load just pauses new orders
  test('should pause new orders when the limit is lowered below the current load', async () => {
    await order();
    await order();
    const res = await save(settings({ maxActiveOrders: 1 }));
    expect(res.body).toMatchObject({ maxActiveOrders: 1, activeOrders: 2 });
    expect((await order()).status).toBe(409);
  });

  // Concurrency: two orders for the last place – only one gets it
  test('should not go over the limit when orders arrive at once', async () => {
    await save(settings({ maxActiveOrders: 1 }));
    const results = await Promise.all([order(), order()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

// ─────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────
describe('Notifications', () => {
  // Boundary: none yet
  test('should start with no notifications', async () => {
    expect(await notes()).toEqual({ unreadCount: 0, notifications: [] });
  });

  // Valid partition: a new order creates an unread notification
  test('should notify about a new order', async () => {
    const placed = (await order([{ itemId: kopiId, quantity: 2 }])).body;

    const { unreadCount, notifications } = await notes();

    expect(unreadCount).toBe(1);
    expect(notifications[0]).toMatchObject({
      type: 'NEW_ORDER',
      orderId: placed.id,
      readAt: null,
    });
    expect(notifications[0].message).toMatch(
      new RegExp(`^New order #${placed.orderNumber} for .+ \\(2 items, \\$3\\.00\\)$`),
    );
  });

  // Boundary: low stock when crossing the threshold, sold out at 0
  test('should notify about low stock and then sold out', async () => {
    await order([{ itemId: toastId, quantity: 3 }]); // 6 → 3 (threshold 3)
    await order([{ itemId: toastId, quantity: 3 }]); // 3 → 0

    const types = (await notes()).notifications.map((n) => n.type);
    expect(types.filter((t) => t === 'LOW_STOCK')).toHaveLength(1);
    expect(types.filter((t) => t === 'SOLD_OUT')).toHaveLength(1);
    expect(types.filter((t) => t === 'NEW_ORDER')).toHaveLength(2);
  });

  // Valid partition: switched-off types are not created
  test('should only create the notifications that are switched on', async () => {
    await save(settings({}, { newOrder: false, lowStock: false }));
    await order([{ itemId: toastId, quantity: 6 }]);

    const { notifications } = await notes();
    expect(notifications.map((n) => n.type)).toEqual(['SOLD_OUT']);
  });

  // Error handling: a refused order creates no notification
  test('should not notify about an order that was refused', async () => {
    await order([{ itemId: toastId, quantity: 7 }]);
    expect((await notes()).notifications).toEqual([]);
  });

  test('should mark all as read', async () => {
    await order();
    await order();

    const res = await request(app).post(`${notesUrl()}/read-all`);

    expect(res.body).toEqual({ unreadCount: 0, marked: 2 });
    const after = await notes();
    expect(after.unreadCount).toBe(0);
    expect(after.notifications.every((n) => n.readAt !== null)).toBe(true);
  });

  test('should clear all notifications', async () => {
    await order();
    const res = await request(app).delete(notesUrl());
    expect(res.body).toEqual({ unreadCount: 0, deleted: 1 });
    expect((await notes()).notifications).toEqual([]);
  });

  test("should keep each stall's notifications separate", async () => {
    await order();
    expect((await notes(otherVendorId)).notifications).toEqual([]);
    await request(app).delete(notesUrl(otherVendorId));
    expect((await notes()).notifications).toHaveLength(1);
  });

  test.each([
    ['get', ''],
    ['post', '/read-all'],
    ['delete', ''],
  ])('%s should return 404 for an unknown vendor', async (method, path) => {
    const res = await request(app)[method](`${notesUrl(999999)}${path}`);
    expect(res.status).toBe(404);
  });
});
