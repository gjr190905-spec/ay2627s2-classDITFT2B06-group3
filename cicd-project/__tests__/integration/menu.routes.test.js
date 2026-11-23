const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/models/db');
const { deleteVendors } = require('../helpers/cleanup');

// ── DB Setup / Teardown ──────────────────────────────────
// Tables come from the Jest globalSetup (configs/jest-integration-setup.js).
// Each test starts with two vendors of its own: an open one with two menu items
// (one available, one sold out) and a second, closed one with one item.
// Integration test files run one at a time (--runInBand), because
// vendor.routes.test.js empties the "Vendor" table between its tests.

const EMAILS = ['menu-a@makanliao.sg', 'menu-b@makanliao.sg'];
let vendorId;
let otherVendorId;
let laksaId; // available, not counting
let otahId; // sold out
let otherItemId; // belongs to the other vendor

const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201e2b2e5a00000000049454e44ae426082',
  'hex',
);
const PNG_DATA_URL = `data:image/png;base64,${PNG_1PX.toString('base64')}`;
const JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64')}`;

async function insertVendor(email, stallName, isOpen) {
  const { rows } = await pool.query(
    `INSERT INTO "Vendor" ("email", "stallName", "isOpen") VALUES ($1, $2, $3) RETURNING "id"`,
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
  vendorId = await insertVendor(EMAILS[0], 'Menu Test Laksa', true);
  otherVendorId = await insertVendor(EMAILS[1], 'Menu Test Kopi', false);
  laksaId = await insertItem(vendorId, 'Curry Laksa', 550, null, false);
  otahId = await insertItem(vendorId, 'Otah', 150, null, true);
  otherItemId = await insertItem(otherVendorId, 'Kopi', 150, null, false);
});

afterAll(async () => {
  await deleteVendors(pool, 'v."email" = ANY($1)', [EMAILS]);
  await pool.end();
});

// ── Helpers ──────────────────────────────────────────────
const base = (vid = vendorId) => `/vendors/${vid}/menu`;
const itemUrl = (id, vid = vendorId) => `${base(vid)}/items/${id}`;

async function dbItem(id) {
  const { rows } = await pool.query('SELECT * FROM "MenuItem" WHERE "id" = $1', [id]);
  return rows[0];
}

// ─────────────────────────────────────────────────────────
// GET /vendors/:vendorId/menu
// ─────────────────────────────────────────────────────────
describe('GET /vendors/:vendorId/menu', () => {
  // Valid partition: stall, banner and items with availability
  test('should return the stall, banner and items', async () => {
    const res = await request(app).get(base());

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.vendor).toEqual({
      id: vendorId,
      isActive: true,
      stallName: 'Menu Test Laksa',
      logoUrl: null,
      isOpen: true,
    });
    expect(res.body.bannerUrl).toBeNull();
    expect(res.body.items.map((i) => [i.name, i.isAvailable])).toEqual([
      ['Curry Laksa', true],
      ['Otah', false],
    ]);
    expect(res.body.items[0]).toMatchObject({ priceCents: 550, price: 5.5, imageUrl: null });
  });

  // Valid partition: another vendor's items are never mixed in
  test("should not include another vendor's items", async () => {
    const res = await request(app).get(base(otherVendorId));
    expect(res.body.items.map((i) => i.name)).toEqual(['Kopi']);
  });

  // Boundary: a vendor with no items
  test('should return an empty list for a vendor with no items (boundary)', async () => {
    await pool.query('DELETE FROM "MenuItem" WHERE "vendorId" = $1', [vendorId]);
    const res = await request(app).get(base());
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  // Error handling: unknown and bad vendor ids
  test('should return 404 for an unknown vendor', async () => {
    const res = await request(app).get(base(999999));
    expect(res.status).toBe(404);
  });

  test('should return 400 for a bad vendor id', async () => {
    const res = await request(app).get('/vendors/abc/menu');
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────
// POST /vendors/:vendorId/menu/items
// ─────────────────────────────────────────────────────────
describe('POST /vendors/:vendorId/menu/items', () => {
  // Valid partition: every field
  test('should add an item and return 201', async () => {
    const res = await request(app)
      .post(`${base()}/items`)
      .send({ name: '  Mee   Siam ', description: 'Tangy', price: '4.50', quantityLeft: 12 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      vendorId,
      name: 'Mee Siam',
      description: 'Tangy',
      priceCents: 450,
      quantityLeft: 12,
      isAvailable: true,
    });
    expect(await dbItem(res.body.id)).toMatchObject({ priceCents: 450, deletedAt: null });
  });

  // Boundary: added with 0 left → sold out straight away
  test('should add an item with 0 left as sold out (boundary)', async () => {
    const res = await request(app)
      .post(`${base()}/items`)
      .send({ name: 'Lontong', price: 4, quantityLeft: 0 });
    expect(res.status).toBe(201);
    expect(res.body.isAvailable).toBe(false);
  });

  // Error handling: duplicate name on the same menu (ignoring case and spaces)
  test('should return 409 for a name already on this menu', async () => {
    const res = await request(app)
      .post(`${base()}/items`)
      .send({ name: ' curry LAKSA', price: '5' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already have an item/);
  });

  // Valid partition: the same name on another vendor's menu is fine
  test("should allow a name used on another vendor's menu", async () => {
    const res = await request(app).post(`${base()}/items`).send({ name: 'Kopi', price: '1.5' });
    expect(res.status).toBe(201);
  });

  // Invalid partition / boundary: bad fields
  test.each([
    [{ price: '1' }, /name/],
    [{ name: 'A', price: '0' }, /Price/],
    [{ name: 'A', price: '1000' }, /Price/],
    [{ name: 'A', price: '1', quantityLeft: 10000 }, /Quantity/],
    [{ name: 'A'.repeat(61), price: '1' }, /60/],
    [{ name: '<img src=x>', price: '1' }, /not allowed/],
  ])('should return 400 for %p', async (body, message) => {
    const res = await request(app).post(`${base()}/items`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  test('should return 404 for an unknown vendor', async () => {
    const res = await request(app)
      .post(`${base(999999)}/items`)
      .send({ name: 'A', price: '1' });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// PATCH /vendors/:vendorId/menu/items/:itemId
// ─────────────────────────────────────────────────────────
describe('PATCH /vendors/:vendorId/menu/items/:itemId', () => {
  // Valid partition: change name, description and price
  test('should update the given fields only', async () => {
    const res = await request(app)
      .patch(itemUrl(laksaId))
      .send({ name: 'Laksa (Large)', description: 'Extra cockles', price: '6.80' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Laksa (Large)',
      description: 'Extra cockles',
      priceCents: 680,
      quantityLeft: null,
      isAvailable: true,
    });
  });

  // Boundary: quantity 0 → sold out; then 1 → available again
  test('should mark sold out at 0 left and available again when restocked (boundary)', async () => {
    const zero = await request(app).patch(itemUrl(laksaId)).send({ quantityLeft: 0 });
    expect(zero.body).toMatchObject({ quantityLeft: 0, isAvailable: false });

    const one = await request(app).patch(itemUrl(laksaId)).send({ quantityLeft: 1 });
    expect(one.body).toMatchObject({ quantityLeft: 1, isAvailable: true });
  });

  // Valid partition: stop counting keeps the item's switch as it was
  test('should keep a sold-out item sold out when counting stops', async () => {
    const res = await request(app).patch(itemUrl(otahId)).send({ quantityLeft: null });
    expect(res.body).toMatchObject({ quantityLeft: null, isAvailable: false });
  });

  test('should return 409 when renaming to a name already on the menu', async () => {
    const res = await request(app).patch(itemUrl(otahId)).send({ name: 'Curry Laksa' });
    expect(res.status).toBe(409);
  });

  test('should return 400 for an empty body', async () => {
    const res = await request(app).patch(itemUrl(laksaId)).send({});
    expect(res.status).toBe(400);
  });

  // Error handling: can't edit another vendor's item through your own menu
  test("should return 404 for another vendor's item", async () => {
    const res = await request(app).patch(itemUrl(otherItemId)).send({ price: '0.10' });
    expect(res.status).toBe(404);
    expect((await dbItem(otherItemId)).priceCents).toBe(150);
  });

  test('should return 404 for a non-existing item (boundary)', async () => {
    const res = await request(app).patch(itemUrl(999999)).send({ price: '1' });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// PATCH /vendors/:vendorId/menu/items/:itemId/availability
// ─────────────────────────────────────────────────────────
describe('PATCH .../items/:itemId/availability', () => {
  // Valid partition: Available → Sold out, and the customer menu shows it
  test('should mark an item sold out on the customer menu', async () => {
    const res = await request(app)
      .patch(`${itemUrl(laksaId)}/availability`)
      .send({ isAvailable: false });

    expect(res.status).toBe(200);
    expect(res.body.isAvailable).toBe(false);
    const menu = await request(app).get(base());
    expect(menu.body.items.find((i) => i.id === laksaId).isAvailable).toBe(false);
  });

  // Valid partition: Sold out → Available
  test('should make a sold-out item available again', async () => {
    const res = await request(app)
      .patch(`${itemUrl(otahId)}/availability`)
      .send({ isAvailable: true });
    expect(res.body.isAvailable).toBe(true);
  });

  // Boundary: switching to the current state is harmless (double click)
  test('should return 200 when already in that state', async () => {
    const res = await request(app)
      .patch(`${itemUrl(laksaId)}/availability`)
      .send({ isAvailable: true });
    expect(res.status).toBe(200);
    expect(res.body.isAvailable).toBe(true);
  });

  // Error handling: 0 left can't be made available
  test('should return 409 for an item with 0 left', async () => {
    await request(app).patch(itemUrl(laksaId)).send({ quantityLeft: 0 });
    const res = await request(app)
      .patch(`${itemUrl(laksaId)}/availability`)
      .send({ isAvailable: true });
    expect(res.status).toBe(409);
    expect((await dbItem(laksaId)).isSoldOut).toBe(true);
  });

  test('should return 400 when isAvailable is not true/false', async () => {
    const res = await request(app)
      .patch(`${itemUrl(laksaId)}/availability`)
      .send({ isAvailable: 'yes' });
    expect(res.status).toBe(400);
  });

  test("should return 404 for another vendor's item", async () => {
    const res = await request(app)
      .patch(`${itemUrl(otherItemId)}/availability`)
      .send({ isAvailable: false });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// DELETE /vendors/:vendorId/menu/items/:itemId
// ─────────────────────────────────────────────────────────
describe('DELETE /vendors/:vendorId/menu/items/:itemId', () => {
  // Valid partition: hidden from the menu, row kept, photo removed
  test('should delete an item from the menu', async () => {
    await request(app)
      .put(`${itemUrl(laksaId)}/image`)
      .send({ image: PNG_DATA_URL });

    const res = await request(app).delete(itemUrl(laksaId));

    expect(res.status).toBe(204);
    const menu = await request(app).get(base());
    expect(menu.body.items.map((i) => i.id)).not.toContain(laksaId);
    expect((await dbItem(laksaId)).deletedAt).not.toBeNull();
    const photos = await pool.query('SELECT 1 FROM "MenuItemImage" WHERE "itemId" = $1', [laksaId]);
    expect(photos.rows).toHaveLength(0);
  });

  // Boundary: a deleted name can be reused
  test('should allow adding an item with the name of a deleted one', async () => {
    await request(app).delete(itemUrl(laksaId));
    const res = await request(app)
      .post(`${base()}/items`)
      .send({ name: 'Curry Laksa', price: '5.5' });
    expect(res.status).toBe(201);
  });

  // Error handling: deleting twice, and deleting another vendor's item
  test('should return 404 when the item was already deleted', async () => {
    await request(app).delete(itemUrl(laksaId));
    const res = await request(app).delete(itemUrl(laksaId));
    expect(res.status).toBe(404);
  });

  test("should return 404 for another vendor's item", async () => {
    const res = await request(app).delete(itemUrl(otherItemId));
    expect(res.status).toBe(404);
    expect((await dbItem(otherItemId)).deletedAt).toBeNull();
  });

  test('should return 404 for the item details after deleting', async () => {
    await request(app).delete(itemUrl(laksaId));
    const res = await request(app).get(itemUrl(laksaId));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// Item photos
// ─────────────────────────────────────────────────────────
describe('Item photo routes', () => {
  // Valid partition: upload, then read it back as an image
  test('should store a photo in the database and serve it', async () => {
    const put = await request(app)
      .put(`${itemUrl(laksaId)}/image`)
      .send({ image: PNG_DATA_URL });

    expect(put.status).toBe(200);
    expect(put.body.imageUrl).toMatch(
      new RegExp(`^/vendors/${vendorId}/menu/items/${laksaId}/image\\?v=\\d+$`),
    );

    const get = await request(app).get(put.body.imageUrl);
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(get.body, PNG_1PX)).toBe(0);
  });

  // Boundary: a second photo replaces the first (one photo per item)
  test('should keep only one photo per item', async () => {
    await request(app)
      .put(`${itemUrl(laksaId)}/image`)
      .send({ image: PNG_DATA_URL });
    await request(app)
      .put(`${itemUrl(laksaId)}/image`)
      .send({ image: JPEG_DATA_URL });

    const { rows } = await pool.query(
      'SELECT "mimeType" FROM "MenuItemImage" WHERE "itemId" = $1',
      [laksaId],
    );
    expect(rows).toEqual([{ mimeType: 'image/jpeg' }]);
  });

  test('should remove a photo', async () => {
    await request(app)
      .put(`${itemUrl(laksaId)}/image`)
      .send({ image: PNG_DATA_URL });

    const res = await request(app).delete(`${itemUrl(laksaId)}/image`);

    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toBeNull();
    expect((await request(app).get(`${itemUrl(laksaId)}/image`)).status).toBe(404);
  });

  // Error handling: not an image, too large, missing item
  test('should return 400 for a file that is not an image', async () => {
    const fake = `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`;
    const res = await request(app)
      .put(`${itemUrl(laksaId)}/image`)
      .send({ image: fake });
    expect(res.status).toBe(400);
  });

  test('should return 404 for a photo of an item with none', async () => {
    const res = await request(app).get(`${itemUrl(laksaId)}/image`);
    expect(res.status).toBe(404);
  });

  test("should return 404 when uploading to another vendor's item", async () => {
    const res = await request(app)
      .put(`${itemUrl(otherItemId)}/image`)
      .send({ image: PNG_DATA_URL });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// Menu banner
// ─────────────────────────────────────────────────────────
describe('Menu banner routes', () => {
  // Valid partition: upload, see it on the menu, read it back
  test('should store the banner and show it on the menu', async () => {
    const put = await request(app).put(`${base()}/banner`).send({ image: PNG_DATA_URL });

    expect(put.status).toBe(200);
    const menu = await request(app).get(base());
    expect(menu.body.bannerUrl).toBe(put.body.bannerUrl);

    const get = await request(app).get(put.body.bannerUrl);
    expect(get.status).toBe(200);
    expect(get.headers['cache-control']).toContain('immutable');
  });

  // Boundary: only one banner can exist; a new one replaces it
  test('should keep only one banner per vendor', async () => {
    await request(app).put(`${base()}/banner`).send({ image: PNG_DATA_URL });
    await request(app).put(`${base()}/banner`).send({ image: JPEG_DATA_URL });

    const { rows } = await pool.query('SELECT "mimeType" FROM "MenuBanner" WHERE "vendorId" = $1', [
      vendorId,
    ]);
    expect(rows).toEqual([{ mimeType: 'image/jpeg' }]);
  });

  test('should remove the banner', async () => {
    await request(app).put(`${base()}/banner`).send({ image: PNG_DATA_URL });

    const res = await request(app).delete(`${base()}/banner`);

    expect(res.body).toEqual({ bannerUrl: null });
    expect((await request(app).get(base())).body.bannerUrl).toBeNull();
    expect((await request(app).get(`${base()}/banner`)).status).toBe(404);
  });

  test('should return 400 without an image', async () => {
    const res = await request(app).put(`${base()}/banner`).send({});
    expect(res.status).toBe(400);
  });

  test.each(['put', 'delete'])('%s should return 404 for an unknown vendor', async (method) => {
    const res = await request(app)
      [method](`${base(999999)}/banner`)
      .send({ image: PNG_DATA_URL });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// POST /vendors/:vendorId/menu/checkout-check
// ─────────────────────────────────────────────────────────
describe('POST /vendors/:vendorId/menu/checkout-check', () => {
  // Invalid partition: a stall an admin has deactivated is treated as closed
  test('should refuse the basket while the stall is deactivated', async () => {
    await pool.query('UPDATE "Vendor" SET "isActive" = FALSE WHERE "id" = $1', [vendorId]);
    const res = await request(app)
      .post(`/vendors/${vendorId}/menu/checkout-check`)
      .send({ items: [{ itemId: laksaId, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.problems.map((p) => p.code)).toContain('STALL_CLOSED');
  });

  const check = (body, vid = vendorId) =>
    request(app)
      .post(`${base(vid)}/checkout-check`)
      .send(body);

  // Valid partition: available items at an open stall
  test('should return 200 and the total for a basket that can be ordered', async () => {
    const res = await check({ items: [{ itemId: laksaId, quantity: 2 }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      items: [
        {
          itemId: laksaId,
          name: 'Curry Laksa',
          priceCents: 550,
          quantity: 2,
          lineTotalCents: 1100,
        },
      ],
      totalCents: 1100,
    });
  });

  // Error handling: the vendor's Sold out switch is applied at checkout
  test('should refuse an item the vendor marked sold out', async () => {
    await request(app)
      .patch(`${itemUrl(laksaId)}/availability`)
      .send({ isAvailable: false });

    const res = await check({ items: [{ itemId: laksaId, quantity: 1 }] });

    expect(res.status).toBe(409);
    expect(res.body.problems).toEqual([
      { itemId: laksaId, code: 'SOLD_OUT', message: 'Curry Laksa is sold out' },
    ]);
  });

  // Valid partition: switching back to Available lets it through again
  test('should accept an item the vendor made available again', async () => {
    await request(app)
      .patch(`${itemUrl(otahId)}/availability`)
      .send({ isAvailable: true });
    const res = await check({ items: [{ itemId: otahId, quantity: 1 }] });
    expect(res.status).toBe(200);
  });

  // Boundary: exactly the quantity left is fine; one more is refused
  test('should accept exactly the quantity left and refuse one more (boundary)', async () => {
    await request(app).patch(itemUrl(laksaId)).send({ quantityLeft: 3 });

    expect((await check({ items: [{ itemId: laksaId, quantity: 3 }] })).status).toBe(200);
    const over = await check({ items: [{ itemId: laksaId, quantity: 4 }] });
    expect(over.status).toBe(409);
    expect(over.body.problems[0]).toMatchObject({ code: 'NOT_ENOUGH', quantityLeft: 3 });
  });

  // Valid partition: the same item twice counts together
  test('should add up the same item listed twice', async () => {
    await request(app).patch(itemUrl(laksaId)).send({ quantityLeft: 3 });
    const res = await check({
      items: [
        { itemId: laksaId, quantity: 2 },
        { itemId: laksaId, quantity: 2 },
      ],
    });
    expect(res.status).toBe(409);
  });

  test('should refuse deleted items and items from another stall', async () => {
    await request(app).delete(itemUrl(laksaId));
    const res = await check({
      items: [
        { itemId: laksaId, quantity: 1 },
        { itemId: otherItemId, quantity: 1 },
      ],
    });
    expect(res.body.problems.map((p) => p.code)).toEqual(['NOT_FOUND', 'NOT_FOUND']);
  });

  test('should refuse the basket when the stall is closed', async () => {
    const res = await check({ items: [{ itemId: otherItemId, quantity: 1 }] }, otherVendorId);
    expect(res.status).toBe(409);
    expect(res.body.problems[0].code).toBe('STALL_CLOSED');
  });

  test('should return 400 for an empty basket (boundary)', async () => {
    const res = await check({ items: [] });
    expect(res.status).toBe(400);
  });

  test('should return 404 for an unknown vendor', async () => {
    const res = await check({ items: [{ itemId: 1, quantity: 1 }] }, 999999);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// Database rules (safety net under the API)
// ─────────────────────────────────────────────────────────
describe('MenuItem table rules', () => {
  // The database itself refuses an item with 0 left that isn't sold out
  test('should refuse 0 left while available', async () => {
    await expect(
      pool.query('UPDATE "MenuItem" SET "quantityLeft" = 0, "isSoldOut" = FALSE WHERE "id" = $1', [
        laksaId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  // Deleting a vendor removes their menu
  test('should delete the menu when the vendor is deleted', async () => {
    await deleteVendors(pool, 'v."id" = $1', [vendorId]);
    const { rows } = await pool.query('SELECT 1 FROM "MenuItem" WHERE "vendorId" = $1', [vendorId]);
    expect(rows).toHaveLength(0);
  });
});
