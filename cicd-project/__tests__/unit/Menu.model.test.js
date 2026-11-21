const pool = require('../../src/models/db');
const {
  itemImageUrlFor,
  bannerUrlFor,
  toMenuItem,
  getMenu,
  getMenuItem,
  createMenuItem,
  updateMenuItem,
  setMenuItemAvailability,
  deleteMenuItem,
  updateMenuItemImage,
  deleteMenuItemImage,
  getMenuItemImage,
  updateMenuBanner,
  deleteMenuBanner,
  getMenuBanner,
  checkCheckoutItems,
} = require('../../src/models/Menu.model');

// ── Mocking ──────────────────────────────────────────────
// Transactions check out a client, so pool.connect() returns a fake client
// with its own query mock.
const client = { query: jest.fn(), release: jest.fn() };

jest.mock('../../src/models/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
}));

// Ordering rules (order limit + notification choices) come from Settings.model
const NO_LIMIT = {
  maxActiveOrders: null,
  activeOrders: 0,
  notifications: { newOrder: true, soldOut: true, lowStock: true, lowStockThreshold: 3 },
};
jest.mock('../../src/models/Settings.model', () => ({ loadOrderingRules: jest.fn() }));
const { loadOrderingRules } = require('../../src/models/Settings.model');

const IMAGE_TIME = new Date('2026-11-19T10:00:00Z');

// A row as the database returns it
const row = {
  id: 5,
  vendorId: 2,
  name: 'Curry Laksa',
  description: 'Rich broth',
  priceCents: 550,
  quantityLeft: null,
  isSoldOut: false,
  updatedAt: IMAGE_TIME,
  imageUpdatedAt: null,
};

const dbDown = Object.assign(new Error('connection lost'), { code: '08006' });
const uniqueViolation = Object.assign(new Error('duplicate'), { code: '23505' });
const fkViolation = Object.assign(new Error('no vendor'), { code: '23503' });

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(client);
});

/** SQL strings sent through the transaction client, in order. */
function clientSql() {
  return client.query.mock.calls.map(([sql]) => sql.trim());
}

/** Make client.query answer BEGIN/COMMIT/ROLLBACK with nothing and the rest in order. */
function clientAnswers(...results) {
  const queue = [...results];
  client.query.mockImplementation((sql) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return Promise.resolve({ rows: [] });
    const next = queue.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
}

// ── Helpers ──────────────────────────────────────────────
describe('Menu.model - picture addresses', () => {
  test('should build a versioned item photo address', () => {
    expect(itemImageUrlFor(2, 5, 123)).toBe('/vendors/2/menu/items/5/image?v=123');
  });

  test('should build a versioned banner address', () => {
    expect(bannerUrlFor(2, 123)).toBe('/vendors/2/menu/banner?v=123');
  });
});

describe('Menu.model - toMenuItem', () => {
  // Valid partition: available item without a photo
  test('should add price in dollars, isAvailable and a null imageUrl', () => {
    expect(toMenuItem(row)).toEqual({
      id: 5,
      vendorId: 2,
      name: 'Curry Laksa',
      description: 'Rich broth',
      priceCents: 550,
      price: 5.5,
      quantityLeft: null,
      isSoldOut: false,
      isAvailable: true,
      imageUrl: null,
      updatedAt: IMAGE_TIME,
    });
  });

  // Valid partition: sold-out item with a photo
  test('should mark sold-out items unavailable and link the photo', () => {
    const item = toMenuItem({ ...row, isSoldOut: true, imageUpdatedAt: IMAGE_TIME });
    expect(item.isAvailable).toBe(false);
    expect(item.imageUrl).toBe(`/vendors/2/menu/items/5/image?v=${IMAGE_TIME.getTime()}`);
  });
});

// ── getMenu ──────────────────────────────────────────────
describe('Menu.model - getMenu', () => {
  const vendorRow = {
    id: 2,
    stallName: 'Mdm Lim Laksa',
    logoUrl: null,
    isOpen: true,
    bannerUpdatedAt: null,
  };

  // Valid partition: vendor with items and no banner
  test('should return the vendor, a null banner and the items', async () => {
    pool.query.mockResolvedValueOnce({ rows: [vendorRow] }).mockResolvedValueOnce({ rows: [row] });

    const menu = await getMenu(2);

    expect(menu).toEqual({
      vendor: { id: 2, stallName: 'Mdm Lim Laksa', logoUrl: null, isOpen: true },
      bannerUrl: null,
      items: [toMenuItem(row)],
    });
    const [itemsSql, itemsParams] = pool.query.mock.calls[1];
    expect(itemsSql).toContain('"deletedAt" IS NULL');
    expect(itemsParams).toEqual([2]);
  });

  // Valid partition: banner present
  test('should link the banner when there is one', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...vendorRow, bannerUpdatedAt: IMAGE_TIME }] })
      .mockResolvedValueOnce({ rows: [] });

    const menu = await getMenu(2);

    expect(menu.bannerUrl).toBe(`/vendors/2/menu/banner?v=${IMAGE_TIME.getTime()}`);
    expect(menu.items).toEqual([]); // boundary: empty menu
  });

  // Boundary: unknown vendor → undefined, items never queried
  test('should return undefined for an unknown vendor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(getMenu(99)).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  // Error handling
  test('should pass database errors on', async () => {
    pool.query.mockRejectedValue(dbDown);
    await expect(getMenu(2)).rejects.toBe(dbDown);
  });
});

describe('Menu.model - getMenuItem', () => {
  test('should return the item, scoped to the vendor', async () => {
    pool.query.mockResolvedValue({ rows: [row] });
    await expect(getMenuItem(2, 5)).resolves.toEqual(toMenuItem(row));
    expect(pool.query.mock.calls[0][1]).toEqual([5, 2]);
  });

  test('should return undefined when not found', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await expect(getMenuItem(2, 5)).resolves.toBeUndefined();
  });
});

// ── createMenuItem ───────────────────────────────────────
describe('Menu.model - createMenuItem', () => {
  const fields = { name: 'Kopi', description: null, priceCents: 150, quantityLeft: null };

  // Valid partition: available when not counting
  test('should insert an available item', async () => {
    pool.query.mockResolvedValue({ rows: [row] });

    await expect(createMenuItem(2, fields)).resolves.toEqual(toMenuItem(row));
    expect(pool.query.mock.calls[0][1]).toEqual([2, 'Kopi', null, 150, null, false]);
  });

  // Boundary: 0 left starts sold out (keeps the zero-left CHECK happy)
  test('should start sold out when added with 0 left (boundary)', async () => {
    pool.query.mockResolvedValue({ rows: [row] });
    await createMenuItem(2, { ...fields, quantityLeft: 0 });
    expect(pool.query.mock.calls[0][1][5]).toBe(true);
  });

  // Boundary: 1 left is still available
  test('should start available when added with 1 left (boundary)', async () => {
    pool.query.mockResolvedValue({ rows: [row] });
    await createMenuItem(2, { ...fields, quantityLeft: 1 });
    expect(pool.query.mock.calls[0][1][5]).toBe(false);
  });

  // Error handling: duplicate name → null, missing vendor → undefined, other errors thrown
  test('should return null for a duplicate name', async () => {
    pool.query.mockRejectedValue(uniqueViolation);
    await expect(createMenuItem(2, fields)).resolves.toBeNull();
  });

  test('should return undefined when the vendor does not exist', async () => {
    pool.query.mockRejectedValue(fkViolation);
    await expect(createMenuItem(99, fields)).resolves.toBeUndefined();
  });

  test('should pass other database errors on', async () => {
    pool.query.mockRejectedValue(dbDown);
    await expect(createMenuItem(2, fields)).rejects.toBe(dbDown);
  });
});

// ── updateMenuItem ───────────────────────────────────────
describe('Menu.model - updateMenuItem', () => {
  // Valid partition: only the given columns are set, scoped to vendor and not deleted
  test('should update only the given fields', async () => {
    pool.query.mockResolvedValue({ rows: [row] });

    await updateMenuItem(2, 5, { name: 'Laksa', priceCents: 600 });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('"name" = $3, "priceCents" = $4, "updatedAt" = NOW()');
    expect(sql).toContain('"vendorId" = $2 AND "deletedAt" IS NULL');
    expect(sql).not.toContain('"isSoldOut" =');
    expect(params).toEqual([5, 2, 'Laksa', 600]);
  });

  // Boundary: quantity 0 marks sold out, quantity 1 marks available
  test.each([
    [0, true],
    [1, false],
  ])('quantityLeft=%p should set isSoldOut=%p (boundary)', async (qty, soldOut) => {
    pool.query.mockResolvedValue({ rows: [row] });

    await updateMenuItem(2, 5, { quantityLeft: qty });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('"quantityLeft" = $3, "isSoldOut" = $4');
    expect(params).toEqual([5, 2, qty, soldOut]);
  });

  // Valid partition: stop counting leaves the Available / Sold out switch alone
  test('should not touch isSoldOut when quantity is cleared', async () => {
    pool.query.mockResolvedValue({ rows: [row] });
    await updateMenuItem(2, 5, { quantityLeft: null });
    expect(pool.query.mock.calls[0][0]).not.toContain('"isSoldOut" =');
  });

  test('should return undefined when not found', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await expect(updateMenuItem(2, 5, { name: 'X' })).resolves.toBeUndefined();
  });

  test('should return null for a duplicate name', async () => {
    pool.query.mockRejectedValue(uniqueViolation);
    await expect(updateMenuItem(2, 5, { name: 'X' })).resolves.toBeNull();
  });

  test('should pass other database errors on', async () => {
    pool.query.mockRejectedValue(dbDown);
    await expect(updateMenuItem(2, 5, { name: 'X' })).rejects.toBe(dbDown);
  });
});

// ── setMenuItemAvailability ──────────────────────────────
describe('Menu.model - setMenuItemAvailability', () => {
  // Valid partition: available → sold out, inside a transaction with the row locked
  test('should switch and commit', async () => {
    clientAnswers(
      { rows: [{ quantityLeft: null, isSoldOut: false }] },
      { rows: [] },
      { rows: [{ ...row, isSoldOut: true }] },
    );

    const result = await setMenuItemAvailability(2, 5, false);

    expect(result.changed).toBe(true);
    expect(result.item.isAvailable).toBe(false);
    const sql = clientSql();
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('FOR UPDATE');
    expect(sql[2]).toContain('UPDATE "MenuItem" SET "isSoldOut" = $1');
    expect(client.query.mock.calls[2][1]).toEqual([true, 5]);
    expect(sql[sql.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  // Valid partition: already in that state → no update
  test('should report no change when already in that state', async () => {
    clientAnswers({ rows: [{ quantityLeft: 3, isSoldOut: false }] }, { rows: [row] });

    const result = await setMenuItemAvailability(2, 5, true);

    expect(result.changed).toBe(false);
    expect(clientSql().some((s) => s.startsWith('UPDATE'))).toBe(false);
  });

  // Boundary: 0 left can't be made available; 1 left can
  test('should refuse to make an item with 0 left available (boundary)', async () => {
    clientAnswers({ rows: [{ quantityLeft: 0, isSoldOut: true }] }, { rows: [row] });

    const result = await setMenuItemAvailability(2, 5, true);

    expect(result.noneLeft).toBe(true);
    expect(clientSql().some((s) => s.startsWith('UPDATE'))).toBe(false);
  });

  test('should allow an item with 1 left to be made available (boundary)', async () => {
    clientAnswers({ rows: [{ quantityLeft: 1, isSoldOut: true }] }, { rows: [] }, { rows: [row] });
    const result = await setMenuItemAvailability(2, 5, true);
    expect(result.changed).toBe(true);
  });

  test('should return undefined when not found', async () => {
    clientAnswers({ rows: [] });
    await expect(setMenuItemAvailability(2, 5, true)).resolves.toBeUndefined();
  });

  // Error handling: roll back and release the client
  test('should roll back and pass errors on', async () => {
    clientAnswers(dbDown);
    await expect(setMenuItemAvailability(2, 5, true)).rejects.toBe(dbDown);
    expect(clientSql()).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ── deleteMenuItem ───────────────────────────────────────
describe('Menu.model - deleteMenuItem', () => {
  // Valid partition: hidden (not removed) and its photo deleted
  test('should hide the item and delete its photo', async () => {
    clientAnswers({ rows: [{ id: 5 }] }, { rows: [] });

    await expect(deleteMenuItem(2, 5)).resolves.toBe(true);

    const sql = clientSql();
    expect(sql[1]).toContain('SET "deletedAt" = NOW()');
    expect(sql[2]).toContain('DELETE FROM "MenuItemImage"');
    expect(sql.some((s) => s.startsWith('DELETE FROM "MenuItem"'))).toBe(false);
  });

  test('should return false when not found', async () => {
    clientAnswers({ rows: [] });
    await expect(deleteMenuItem(2, 5)).resolves.toBe(false);
    expect(clientSql().some((s) => s.includes('MenuItemImage'))).toBe(false);
  });
});

// ── Item photos ──────────────────────────────────────────
describe('Menu.model - item photos', () => {
  const data = Buffer.from([1, 2, 3]);

  test('should save (upsert) a photo and return the item', async () => {
    clientAnswers(
      { rows: [{ id: 5 }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ ...row, imageUpdatedAt: IMAGE_TIME }] },
    );

    const item = await updateMenuItemImage(2, 5, data, 'image/png');

    expect(item.imageUrl).toContain('/vendors/2/menu/items/5/image?v=');
    expect(clientSql()[2]).toContain('ON CONFLICT ("itemId")');
    expect(client.query.mock.calls[2][1]).toEqual([5, data, 'image/png']);
  });

  test('should return undefined when saving a photo for a missing item', async () => {
    clientAnswers({ rows: [] });
    await expect(updateMenuItemImage(2, 5, data, 'image/png')).resolves.toBeUndefined();
  });

  test('should remove a photo and return the item', async () => {
    clientAnswers({ rows: [{ id: 5 }] }, { rows: [] }, { rows: [row] });
    const item = await deleteMenuItemImage(2, 5);
    expect(item.imageUrl).toBeNull();
    expect(clientSql()[2]).toContain('DELETE FROM "MenuItemImage"');
  });

  test('should return undefined when removing a photo of a missing item', async () => {
    clientAnswers({ rows: [] });
    await expect(deleteMenuItemImage(2, 5)).resolves.toBeUndefined();
  });

  test('should read a stored photo only for items still on the menu', async () => {
    const stored = { data, mimeType: 'image/png', updatedAt: IMAGE_TIME };
    pool.query.mockResolvedValue({ rows: [stored] });

    await expect(getMenuItemImage(2, 5)).resolves.toEqual(stored);
    expect(pool.query.mock.calls[0][0]).toContain('"deletedAt" IS NULL');
  });

  test('should return undefined when there is no photo', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await expect(getMenuItemImage(2, 5)).resolves.toBeUndefined();
  });
});

// ── Banner ───────────────────────────────────────────────
describe('Menu.model - banner', () => {
  const data = Buffer.from([1, 2, 3]);

  test('should save (upsert) the banner and return its address', async () => {
    pool.query.mockResolvedValue({ rows: [{ updatedAt: IMAGE_TIME }] });

    await expect(updateMenuBanner(2, data, 'image/jpeg')).resolves.toEqual({
      bannerUrl: `/vendors/2/menu/banner?v=${IMAGE_TIME.getTime()}`,
    });
    expect(pool.query.mock.calls[0][0]).toContain('ON CONFLICT ("vendorId")');
  });

  test('should return undefined when the vendor does not exist', async () => {
    pool.query.mockRejectedValue(fkViolation);
    await expect(updateMenuBanner(99, data, 'image/jpeg')).resolves.toBeUndefined();
  });

  test('should pass other errors on when saving', async () => {
    pool.query.mockRejectedValue(dbDown);
    await expect(updateMenuBanner(2, data, 'image/jpeg')).rejects.toBe(dbDown);
  });

  test('should remove the banner', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2 }] }).mockResolvedValueOnce({ rows: [] });
    await expect(deleteMenuBanner(2)).resolves.toEqual({ bannerUrl: null });
    expect(pool.query.mock.calls[1][0]).toContain('DELETE FROM "MenuBanner"');
  });

  test('should return undefined when removing the banner of an unknown vendor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(deleteMenuBanner(99)).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('should read the stored banner', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await expect(getMenuBanner(2)).resolves.toBeUndefined();
    expect(pool.query.mock.calls[0][1]).toEqual([2]);
  });
});

// ── checkCheckoutItems ───────────────────────────────────
describe('Menu.model - checkCheckoutItems', () => {
  const menuRows = [
    { id: 1, name: 'Laksa', priceCents: 550, quantityLeft: null, isSoldOut: false },
    { id: 2, name: 'Mee Siam', priceCents: 450, quantityLeft: 3, isSoldOut: false },
    { id: 3, name: 'Otah', priceCents: 150, quantityLeft: null, isSoldOut: true },
  ];

  function answer(isOpen, rows = menuRows, rules = NO_LIMIT) {
    pool.query.mockResolvedValueOnce({ rows: [{ isOpen }] }).mockResolvedValueOnce({ rows });
    loadOrderingRules.mockResolvedValueOnce(rules);
  }

  // Boundary: at the vendor's order limit the basket is refused; one below is fine
  test.each([
    [5, 5, false],
    [4, 5, true],
  ])('with %p of %p orders in progress ok=%p (boundary)', async (active, max, ok) => {
    answer(true, menuRows, { ...NO_LIMIT, maxActiveOrders: max, activeOrders: active });
    const result = await checkCheckoutItems(2, [{ itemId: 1, quantity: 1 }]);
    expect(result.ok).toBe(ok);
    if (!ok) expect(result.problems[0]).toMatchObject({ itemId: null, code: 'STALL_BUSY' });
  });

  // Valid partition: no limit means any number of orders in progress is fine
  test('should ignore the load when there is no limit', async () => {
    answer(true, menuRows, { ...NO_LIMIT, activeOrders: 500 });
    const result = await checkCheckoutItems(2, [{ itemId: 1, quantity: 1 }]);
    expect(result.ok).toBe(true);
  });

  // Valid partition: everything can be ordered
  test('should price a basket that can be ordered', async () => {
    answer(true);

    const result = await checkCheckoutItems(2, [
      { itemId: 1, quantity: 2 },
      { itemId: 2, quantity: 1 },
    ]);

    expect(result).toEqual({
      ok: true,
      problems: [],
      items: [
        { itemId: 1, name: 'Laksa', priceCents: 550, quantity: 2, lineTotalCents: 1100 },
        { itemId: 2, name: 'Mee Siam', priceCents: 450, quantity: 1, lineTotalCents: 450 },
      ],
      totalCents: 1550,
    });
    // Only this vendor's, not-deleted items are looked up
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toContain('"vendorId" = $1');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(params).toEqual([2, [1, 2]]);
  });

  // Boundary: asking for exactly what's left is fine; one more is not
  test('should accept a quantity equal to what is left (boundary)', async () => {
    answer(true);
    const result = await checkCheckoutItems(2, [{ itemId: 2, quantity: 3 }]);
    expect(result.ok).toBe(true);
  });

  test('should refuse one more than what is left (boundary)', async () => {
    answer(true);
    const result = await checkCheckoutItems(2, [{ itemId: 2, quantity: 4 }]);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      { itemId: 2, code: 'NOT_ENOUGH', message: 'Only 3 Mee Siam left', quantityLeft: 3 },
    ]);
  });

  // Error handling: sold out, missing (deleted / other stall) and closed stall
  test('should report sold-out and missing items', async () => {
    answer(true);
    const result = await checkCheckoutItems(2, [
      { itemId: 3, quantity: 1 },
      { itemId: 77, quantity: 1 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toEqual(['SOLD_OUT', 'NOT_FOUND']);
    expect(result.totalCents).toBe(0);
  });

  test('should refuse the basket when the stall is closed', async () => {
    answer(false);
    const result = await checkCheckoutItems(2, [{ itemId: 1, quantity: 1 }]);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatchObject({ itemId: null, code: 'STALL_CLOSED' });
  });

  test('should return undefined for an unknown vendor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(checkCheckoutItems(99, [{ itemId: 1, quantity: 1 }])).resolves.toBeUndefined();
  });
});
