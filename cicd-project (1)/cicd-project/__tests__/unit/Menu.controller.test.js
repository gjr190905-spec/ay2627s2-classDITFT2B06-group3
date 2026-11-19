const model = require('../../src/models/Menu.model');
const {
  NAME_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  QUANTITY_MAX,
  CHECKOUT_MAX_LINES,
  CHECKOUT_MAX_QUANTITY,
  validateName,
  validateDescription,
  validatePrice,
  validateQuantity,
  validateNewItem,
  validateItemChanges,
  validateCheckoutPayload,
  getVendorMenu,
  getVendorMenuItem,
  addMenuItem,
  editMenuItem,
  changeAvailability,
  removeMenuItem,
  putMenuItemImage,
  removeMenuItemImage,
  sendMenuItemImage,
  putMenuBanner,
  removeMenuBanner,
  sendMenuBanner,
  checkCheckout,
} = require('../../src/controllers/Menu.controller');

// ── Mocking ──────────────────────────────────────────────
// Every DB-touching model function is mocked; URL helpers stay real.
jest.mock('../../src/models/Menu.model', () => ({
  ...jest.requireActual('../../src/models/Menu.model'),
  getMenu: jest.fn(),
  getMenuItem: jest.fn(),
  createMenuItem: jest.fn(),
  updateMenuItem: jest.fn(),
  setMenuItemAvailability: jest.fn(),
  deleteMenuItem: jest.fn(),
  updateMenuItemImage: jest.fn(),
  deleteMenuItemImage: jest.fn(),
  getMenuItemImage: jest.fn(),
  updateMenuBanner: jest.fn(),
  deleteMenuBanner: jest.fn(),
  getMenuBanner: jest.fn(),
  checkCheckoutItems: jest.fn(),
}));

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

/** Call a controller and wait for it to finish, returning res and next. */
async function run(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler({ query: {}, body: {}, ...req }, res, next);
  return { res, next };
}

/** The HTTP error passed to next(), if any. */
function errorOf(next) {
  return next.mock.calls[0] && next.mock.calls[0][0];
}

const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201e2b2e5a00000000049454e44ae426082',
  'hex',
);
const PNG_DATA_URL = `data:image/png;base64,${PNG_1PX.toString('base64')}`;

const item = {
  id: 5,
  vendorId: 2,
  name: 'Curry Laksa',
  description: null,
  priceCents: 550,
  price: 5.5,
  quantityLeft: null,
  isSoldOut: false,
  isAvailable: true,
  imageUrl: null,
};
const ITEM_PARAMS = { vendorId: '2', itemId: '5' };
const dbDown = new Error('connection lost');

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────
// Field validators
// ─────────────────────────────────────────────────────────
describe('Menu.controller - validateName', () => {
  // Valid partition: ordinary name, spaces cleaned up
  test('should trim and collapse spaces', () => {
    expect(validateName('  Curry   Laksa ')).toEqual({ value: 'Curry Laksa' });
  });

  // Boundary: 1 and 60 characters are allowed; 0 and 61 are not
  test.each([
    ['a', true],
    ['a'.repeat(NAME_MAX_LENGTH), true],
    ['', false],
    ['   ', false],
    ['a'.repeat(NAME_MAX_LENGTH + 1), false],
  ])('validateName(%p length) valid=%p (boundary)', (raw, valid) => {
    expect(Boolean(validateName(raw).value)).toBe(valid);
  });

  // Invalid partition: not text, or contains HTML / control characters
  test.each([null, 42, undefined, ['x']])('should reject non-text %p', (raw) => {
    expect(validateName(raw).error).toBe('name must be text');
  });

  test.each(['<b>Laksa</b>', 'Lak\u0007sa'])('should reject unsafe characters in %p', (raw) => {
    expect(validateName(raw).error).toMatch(/not allowed/);
  });

  // Valid partition: punctuation and non-English letters people actually use
  test.each(["Ah Ma's Mee Pok", 'Nasi Lemak (Large)', 'Kopi-O & Toast', '鸡饭', 'Rojak + Tofu'])(
    'should accept %p',
    (raw) => {
      expect(validateName(raw)).toEqual({ value: raw });
    },
  );
});

describe('Menu.controller - validateDescription', () => {
  // Valid partition: missing, null and empty all mean "no description"
  test.each([undefined, null, '', '   '])('should treat %p as no description', (raw) => {
    expect(validateDescription(raw)).toEqual({ value: null });
  });

  // Valid partition: text with a line break is kept
  test('should keep a multi-line description', () => {
    expect(validateDescription(' Spicy.\nComes with egg. ')).toEqual({
      value: 'Spicy.\nComes with egg.',
    });
  });

  // Boundary: 200 characters allowed, 201 not
  test('should accept exactly the maximum length (boundary)', () => {
    const text = 'a'.repeat(DESCRIPTION_MAX_LENGTH);
    expect(validateDescription(text)).toEqual({ value: text });
  });

  test('should reject one character over the maximum (boundary)', () => {
    expect(validateDescription('a'.repeat(DESCRIPTION_MAX_LENGTH + 1)).error).toMatch(/200/);
  });

  // Invalid partition: wrong type, HTML
  test('should reject a non-text description', () => {
    expect(validateDescription(5).error).toBe('description must be text');
  });

  test('should reject HTML', () => {
    expect(validateDescription('<script>x</script>').error).toMatch(/not allowed/);
  });
});

describe('Menu.controller - validatePrice', () => {
  // Valid partition: numbers and text, whole or with cents
  test.each([
    ['4.50', 450],
    ['4.5', 450],
    ['4', 400],
    [4.5, 450],
    [12, 1200],
    [' 3.20 ', 320],
  ])('validatePrice(%p) should be %p cents', (raw, cents) => {
    expect(validatePrice(raw)).toEqual({ value: cents });
  });

  // Boundary: 0.01 and 999.99 are allowed; 0, 0.00 and 1000 are not
  test.each([
    ['0.01', 1],
    ['999.99', 99999],
  ])('should accept %p (boundary)', (raw, cents) => {
    expect(validatePrice(raw)).toEqual({ value: cents });
  });

  test.each(['0', '0.00', 0, '1000', 1000])('should reject %p (boundary)', (raw) => {
    expect(validatePrice(raw).error).toBeDefined();
  });

  // Invalid partition: negative, too many decimals, not a number, missing
  test.each(['-1', '4.555', 'abc', '', '1e2', null, undefined, '$4.50', 0.1 + 0.2])(
    'should reject %p',
    (raw) => {
      expect(validatePrice(raw).error).toBeDefined();
    },
  );
});

describe('Menu.controller - validateQuantity', () => {
  // Valid partition: null means "not counting"
  test('should accept null', () => {
    expect(validateQuantity(null)).toEqual({ value: null });
  });

  // Boundary: 0 and 9999 allowed; -1 and 10000 not
  test.each([
    [0, true],
    [QUANTITY_MAX, true],
    [-1, false],
    [QUANTITY_MAX + 1, false],
  ])('validateQuantity(%p) valid=%p (boundary)', (raw, valid) => {
    expect(validateQuantity(raw).error === undefined).toBe(valid);
  });

  // Invalid partition: decimals and text
  test.each([1.5, '3', true])('should reject %p', (raw) => {
    expect(validateQuantity(raw).error).toBeDefined();
  });
});

describe('Menu.controller - validateNewItem', () => {
  // Valid partition: only the required fields
  test('should accept name and price only', () => {
    expect(validateNewItem({ name: 'Kopi', price: '1.50' })).toEqual({
      fields: { name: 'Kopi', description: null, priceCents: 150, quantityLeft: null },
    });
  });

  // Valid partition: every field
  test('should accept every field', () => {
    expect(
      validateNewItem({ name: 'Otah', description: 'Fish cake', price: 1.5, quantityLeft: 10 }),
    ).toEqual({
      fields: { name: 'Otah', description: 'Fish cake', priceCents: 150, quantityLeft: 10 },
    });
  });

  // Error handling: each bad field is reported, in order
  test.each([
    [undefined, 'name must be text'],
    [{ price: '1' }, 'name must be text'],
    [{ name: 'A', description: 3, price: '1' }, 'description must be text'],
    [{ name: 'A' }, /Price must be/],
    [{ name: 'A', price: '1', quantityLeft: -1 }, /Quantity left/],
  ])('should reject %p', (body, message) => {
    expect(validateNewItem(body).error).toMatch(message);
  });
});

describe('Menu.controller - validateItemChanges', () => {
  // Valid partition: one field at a time, mapped to column names
  test('should map price to priceCents', () => {
    expect(validateItemChanges({ price: '6' })).toEqual({ fields: { priceCents: 600 } });
  });

  test('should allow clearing the quantity (stop counting)', () => {
    expect(validateItemChanges({ quantityLeft: null })).toEqual({
      fields: { quantityLeft: null },
    });
  });

  test('should allow clearing the description', () => {
    expect(validateItemChanges({ description: '' })).toEqual({ fields: { description: null } });
  });

  // Boundary: an empty body (zero fields) is refused
  test.each([undefined, {}, { unknown: 1 }])('should reject %p (no fields)', (body) => {
    expect(validateItemChanges(body).error).toMatch(/at least one/);
  });

  // Error handling: a bad field stops validation
  test('should reject a bad name', () => {
    expect(validateItemChanges({ name: '', price: '1' }).error).toBe('Item name is required');
  });
});

describe('Menu.controller - validateCheckoutPayload', () => {
  // Valid partition: a normal basket
  test('should accept a basket', () => {
    expect(validateCheckoutPayload({ items: [{ itemId: 1, quantity: 2 }] })).toEqual({
      lines: [{ itemId: 1, quantity: 2 }],
    });
  });

  // Valid partition: the same item twice is added together
  test('should merge duplicate items', () => {
    const body = {
      items: [
        { itemId: 1, quantity: 2 },
        { itemId: 3, quantity: 1 },
        { itemId: 1, quantity: 4 },
      ],
    };
    expect(validateCheckoutPayload(body)).toEqual({
      lines: [
        { itemId: 1, quantity: 6 },
        { itemId: 3, quantity: 1 },
      ],
    });
  });

  // Boundary: empty basket, 50 lines (ok), 51 lines (too many)
  test.each([undefined, {}, { items: [] }, { items: 'x' }])('should reject %p', (body) => {
    expect(validateCheckoutPayload(body).error).toMatch(/at least one/);
  });

  test('should accept the maximum number of lines (boundary)', () => {
    const items = Array.from({ length: CHECKOUT_MAX_LINES }, (_, i) => ({
      itemId: i + 1,
      quantity: 1,
    }));
    expect(validateCheckoutPayload({ items }).lines).toHaveLength(CHECKOUT_MAX_LINES);
  });

  test('should reject one line over the maximum (boundary)', () => {
    const items = Array.from({ length: CHECKOUT_MAX_LINES + 1 }, (_, i) => ({
      itemId: i + 1,
      quantity: 1,
    }));
    expect(validateCheckoutPayload({ items }).error).toMatch(/at most/);
  });

  // Boundary: quantity 1 and 99 ok; 0 and 100 (also after merging) not
  test('should accept the maximum quantity (boundary)', () => {
    const body = { items: [{ itemId: 1, quantity: CHECKOUT_MAX_QUANTITY }] };
    expect(validateCheckoutPayload(body).lines[0].quantity).toBe(CHECKOUT_MAX_QUANTITY);
  });

  test('should reject more than the maximum quantity after merging (boundary)', () => {
    const body = {
      items: [
        { itemId: 1, quantity: 50 },
        { itemId: 1, quantity: 50 },
      ],
    };
    expect(validateCheckoutPayload(body).error).toMatch(/at most 99/);
  });

  // Invalid partition: bad ids and quantities
  test.each([
    [{ itemId: 0, quantity: 1 }, /itemId/],
    [{ itemId: 'x', quantity: 1 }, /itemId/],
    [null, /itemId/],
    [{ itemId: 1, quantity: 0 }, /quantity/],
    [{ itemId: 1, quantity: 1.5 }, /quantity/],
    [{ itemId: 1 }, /quantity/],
  ])('should reject line %p', (line, message) => {
    expect(validateCheckoutPayload({ items: [line] }).error).toMatch(message);
  });
});

// ─────────────────────────────────────────────────────────
// Handlers – shared id checks
// ─────────────────────────────────────────────────────────
describe('Menu.controller - id checks on every route', () => {
  const vendorRoutes = [
    getVendorMenu,
    addMenuItem,
    putMenuBanner,
    removeMenuBanner,
    sendMenuBanner,
    checkCheckout,
  ];
  const itemRoutes = [
    getVendorMenuItem,
    editMenuItem,
    changeAvailability,
    removeMenuItem,
    putMenuItemImage,
    removeMenuItemImage,
    sendMenuItemImage,
  ];

  // Invalid partition: bad vendor id → 400 before touching the database
  test.each([...vendorRoutes, ...itemRoutes].map((h) => [h.name, h]))(
    '%s should return 400 for a bad vendor id',
    async (_name, handler) => {
      const { next } = await run(handler, { params: { vendorId: 'abc', itemId: '1' } });
      expect(errorOf(next).status).toBe(400);
      expect(errorOf(next).message).toBe('Vendor id must be a positive integer');
    },
  );

  // Boundary: item id 0 → 400
  test.each(itemRoutes.map((h) => [h.name, h]))(
    '%s should return 400 for item id 0 (boundary)',
    async (_name, handler) => {
      const { next } = await run(handler, { params: { vendorId: '2', itemId: '0' } });
      expect(errorOf(next).status).toBe(400);
      expect(errorOf(next).message).toBe('Item id must be a positive integer');
    },
  );
});

// ─────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────
describe('Menu.controller - getVendorMenu', () => {
  // Valid partition: returns the menu and forbids caching (availability must be fresh)
  test('should return 200 with the menu', async () => {
    const menu = { vendor: { id: 2 }, bannerUrl: null, items: [item] };
    model.getMenu.mockResolvedValue(menu);

    const { res } = await run(getVendorMenu, { params: { vendorId: '2' } });

    expect(model.getMenu).toHaveBeenCalledWith(2);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(menu);
  });

  // Boundary: vendor doesn't exist
  test('should return 404 for an unknown vendor', async () => {
    model.getMenu.mockResolvedValue(undefined);
    const { next } = await run(getVendorMenu, { params: { vendorId: '99' } });
    expect(errorOf(next).status).toBe(404);
  });

  // Error handling: DB errors go to the error handler
  test('should pass database errors on', async () => {
    model.getMenu.mockRejectedValue(dbDown);
    const { next } = await run(getVendorMenu, { params: { vendorId: '2' } });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - getVendorMenuItem', () => {
  test('should return 200 with the item', async () => {
    model.getMenuItem.mockResolvedValue(item);
    const { res } = await run(getVendorMenuItem, { params: ITEM_PARAMS });
    expect(model.getMenuItem).toHaveBeenCalledWith(2, 5);
    expect(res.json).toHaveBeenCalledWith(item);
  });

  test('should return 404 for a missing item', async () => {
    model.getMenuItem.mockResolvedValue(undefined);
    const { next } = await run(getVendorMenuItem, { params: ITEM_PARAMS });
    expect(errorOf(next).status).toBe(404);
  });

  test('should pass database errors on', async () => {
    model.getMenuItem.mockRejectedValue(dbDown);
    const { next } = await run(getVendorMenuItem, { params: ITEM_PARAMS });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - addMenuItem', () => {
  const body = { name: 'Kopi', price: '1.50' };

  // Valid partition: created
  test('should return 201 with the new item', async () => {
    model.createMenuItem.mockResolvedValue(item);
    const { res } = await run(addMenuItem, { params: { vendorId: '2' }, body });
    expect(model.createMenuItem).toHaveBeenCalledWith(2, {
      name: 'Kopi',
      description: null,
      priceCents: 150,
      quantityLeft: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  // Invalid partition: bad body never reaches the database
  test('should return 400 for a bad body', async () => {
    const { next } = await run(addMenuItem, { params: { vendorId: '2' }, body: { name: '' } });
    expect(errorOf(next).status).toBe(400);
    expect(model.createMenuItem).not.toHaveBeenCalled();
  });

  test('should return 404 when the vendor does not exist', async () => {
    model.createMenuItem.mockResolvedValue(undefined);
    const { next } = await run(addMenuItem, { params: { vendorId: '2' }, body });
    expect(errorOf(next).status).toBe(404);
  });

  test('should return 409 for a duplicate name', async () => {
    model.createMenuItem.mockResolvedValue(null);
    const { next } = await run(addMenuItem, { params: { vendorId: '2' }, body });
    expect(errorOf(next).status).toBe(409);
  });

  test('should pass database errors on', async () => {
    model.createMenuItem.mockRejectedValue(dbDown);
    const { next } = await run(addMenuItem, { params: { vendorId: '2' }, body });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - editMenuItem', () => {
  test('should return 200 with the updated item', async () => {
    model.updateMenuItem.mockResolvedValue(item);
    const { res } = await run(editMenuItem, { params: ITEM_PARAMS, body: { quantityLeft: 0 } });
    expect(model.updateMenuItem).toHaveBeenCalledWith(2, 5, { quantityLeft: 0 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('should return 400 for an empty body', async () => {
    const { next } = await run(editMenuItem, { params: ITEM_PARAMS, body: {} });
    expect(errorOf(next).status).toBe(400);
  });

  test.each([
    [undefined, 404],
    [null, 409],
  ])('should map a model result of %p to %p', async (result, status) => {
    model.updateMenuItem.mockResolvedValue(result);
    const { next } = await run(editMenuItem, { params: ITEM_PARAMS, body: { name: 'X' } });
    expect(errorOf(next).status).toBe(status);
  });

  test('should pass database errors on', async () => {
    model.updateMenuItem.mockRejectedValue(dbDown);
    const { next } = await run(editMenuItem, { params: ITEM_PARAMS, body: { name: 'X' } });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - changeAvailability', () => {
  // Valid partition: switched, or already in that state (both 200)
  test.each([true, false])('should return 200 when switched (changed=%p)', async (changed) => {
    model.setMenuItemAvailability.mockResolvedValue({ item, changed });
    const { res } = await run(changeAvailability, {
      params: ITEM_PARAMS,
      body: { isAvailable: false },
    });
    expect(model.setMenuItemAvailability).toHaveBeenCalledWith(2, 5, false);
    expect(res.json).toHaveBeenCalledWith(item);
  });

  // Invalid partition: isAvailable must be a real boolean
  test.each([undefined, 'true', 1, null])('should return 400 for isAvailable=%p', async (value) => {
    const { next } = await run(changeAvailability, {
      params: ITEM_PARAMS,
      body: { isAvailable: value },
    });
    expect(errorOf(next).status).toBe(400);
  });

  test('should return 400 when there is no body', async () => {
    const { next } = await run(changeAvailability, { params: ITEM_PARAMS, body: undefined });
    expect(errorOf(next).status).toBe(400);
  });

  test('should return 404 for a missing item', async () => {
    model.setMenuItemAvailability.mockResolvedValue(undefined);
    const { next } = await run(changeAvailability, {
      params: ITEM_PARAMS,
      body: { isAvailable: true },
    });
    expect(errorOf(next).status).toBe(404);
  });

  // Error handling: can't make an item with 0 left available
  test('should return 409 when there are none left', async () => {
    model.setMenuItemAvailability.mockResolvedValue({ noneLeft: true, item });
    const { next } = await run(changeAvailability, {
      params: ITEM_PARAMS,
      body: { isAvailable: true },
    });
    expect(errorOf(next).status).toBe(409);
    expect(errorOf(next).message).toMatch(/0 left/);
  });

  test('should pass database errors on', async () => {
    model.setMenuItemAvailability.mockRejectedValue(dbDown);
    const { next } = await run(changeAvailability, {
      params: ITEM_PARAMS,
      body: { isAvailable: true },
    });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - removeMenuItem', () => {
  test('should return 204 when deleted', async () => {
    model.deleteMenuItem.mockResolvedValue(true);
    const { res } = await run(removeMenuItem, { params: ITEM_PARAMS });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  test('should return 404 when the item is missing', async () => {
    model.deleteMenuItem.mockResolvedValue(false);
    const { next } = await run(removeMenuItem, { params: ITEM_PARAMS });
    expect(errorOf(next).status).toBe(404);
  });

  test('should pass database errors on', async () => {
    model.deleteMenuItem.mockRejectedValue(dbDown);
    const { next } = await run(removeMenuItem, { params: ITEM_PARAMS });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - putMenuItemImage', () => {
  test('should save a valid PNG and return the item', async () => {
    model.updateMenuItemImage.mockResolvedValue(item);
    const { res } = await run(putMenuItemImage, {
      params: ITEM_PARAMS,
      body: { image: PNG_DATA_URL },
    });
    expect(model.updateMenuItemImage).toHaveBeenCalledWith(2, 5, PNG_1PX, 'image/png');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Invalid partition: not an image (checked by its bytes, not the declared type)
  test('should return 400 for a fake image', async () => {
    const fake = `data:image/png;base64,${Buffer.from('hello').toString('base64')}`;
    const { next } = await run(putMenuItemImage, { params: ITEM_PARAMS, body: { image: fake } });
    expect(errorOf(next).status).toBe(400);
    expect(model.updateMenuItemImage).not.toHaveBeenCalled();
  });

  test('should return 404 for a missing item', async () => {
    model.updateMenuItemImage.mockResolvedValue(undefined);
    const { next } = await run(putMenuItemImage, {
      params: ITEM_PARAMS,
      body: { image: PNG_DATA_URL },
    });
    expect(errorOf(next).status).toBe(404);
  });

  test('should pass database errors on', async () => {
    model.updateMenuItemImage.mockRejectedValue(dbDown);
    const { next } = await run(putMenuItemImage, {
      params: ITEM_PARAMS,
      body: { image: PNG_DATA_URL },
    });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - removeMenuItemImage', () => {
  test('should return 200 with the item', async () => {
    model.deleteMenuItemImage.mockResolvedValue(item);
    const { res } = await run(removeMenuItemImage, { params: ITEM_PARAMS });
    expect(res.json).toHaveBeenCalledWith(item);
  });

  test('should return 404 for a missing item', async () => {
    model.deleteMenuItemImage.mockResolvedValue(undefined);
    const { next } = await run(removeMenuItemImage, { params: ITEM_PARAMS });
    expect(errorOf(next).status).toBe(404);
  });

  test('should pass database errors on', async () => {
    model.deleteMenuItemImage.mockRejectedValue(dbDown);
    const { next } = await run(removeMenuItemImage, { params: ITEM_PARAMS });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - sending stored pictures', () => {
  const stored = {
    data: PNG_1PX,
    mimeType: 'image/png',
    updatedAt: new Date('2026-11-19T10:00:00Z'),
  };

  // Valid partition: versioned address is cached for good
  test.each([
    ['item photo', sendMenuItemImage, 'getMenuItemImage', ITEM_PARAMS],
    ['banner', sendMenuBanner, 'getMenuBanner', { vendorId: '2' }],
  ])(
    'should send the %s with a long cache when ?v= is given',
    async (_label, handler, fn, params) => {
      model[fn].mockResolvedValue(stored);
      const { res } = await run(handler, { params, query: { v: '1' } });
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'image/png',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=31536000, immutable',
        }),
      );
      expect(res.send).toHaveBeenCalledWith(PNG_1PX);
    },
  );

  // Valid partition: unversioned address is always rechecked
  test('should ask browsers to recheck when there is no ?v=', async () => {
    model.getMenuBanner.mockResolvedValue(stored);
    const { res } = await run(sendMenuBanner, { params: { vendorId: '2' } });
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Cache-Control': 'no-cache' }));
  });

  // Boundary: nothing stored
  test.each([
    [sendMenuItemImage, 'getMenuItemImage', ITEM_PARAMS],
    [sendMenuBanner, 'getMenuBanner', { vendorId: '2' }],
  ])('should return 404 when nothing is stored', async (handler, fn, params) => {
    model[fn].mockResolvedValue(undefined);
    const { next } = await run(handler, { params });
    expect(errorOf(next).status).toBe(404);
  });

  test.each([
    [sendMenuItemImage, 'getMenuItemImage', ITEM_PARAMS],
    [sendMenuBanner, 'getMenuBanner', { vendorId: '2' }],
  ])('should pass database errors on', async (handler, fn, params) => {
    model[fn].mockRejectedValue(dbDown);
    const { next } = await run(handler, { params });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - putMenuBanner / removeMenuBanner', () => {
  test('should save a banner and return its address', async () => {
    model.updateMenuBanner.mockResolvedValue({ bannerUrl: '/vendors/2/menu/banner?v=1' });
    const { res } = await run(putMenuBanner, {
      params: { vendorId: '2' },
      body: { image: PNG_DATA_URL },
    });
    expect(model.updateMenuBanner).toHaveBeenCalledWith(2, PNG_1PX, 'image/png');
    expect(res.json).toHaveBeenCalledWith({ bannerUrl: '/vendors/2/menu/banner?v=1' });
  });

  test('should return 400 when the image is missing', async () => {
    const { next } = await run(putMenuBanner, { params: { vendorId: '2' }, body: {} });
    expect(errorOf(next).status).toBe(400);
  });

  test.each([
    [putMenuBanner, 'updateMenuBanner', { image: PNG_DATA_URL }],
    [removeMenuBanner, 'deleteMenuBanner', {}],
  ])('should return 404 for an unknown vendor', async (handler, fn, body) => {
    model[fn].mockResolvedValue(undefined);
    const { next } = await run(handler, { params: { vendorId: '2' }, body });
    expect(errorOf(next).status).toBe(404);
  });

  test('should remove the banner', async () => {
    model.deleteMenuBanner.mockResolvedValue({ bannerUrl: null });
    const { res } = await run(removeMenuBanner, { params: { vendorId: '2' } });
    expect(res.json).toHaveBeenCalledWith({ bannerUrl: null });
  });

  test.each([
    [putMenuBanner, 'updateMenuBanner', { image: PNG_DATA_URL }],
    [removeMenuBanner, 'deleteMenuBanner', {}],
  ])('should pass database errors on', async (handler, fn, body) => {
    model[fn].mockRejectedValue(dbDown);
    const { next } = await run(handler, { params: { vendorId: '2' }, body });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Menu.controller - checkCheckout', () => {
  const body = { items: [{ itemId: 5, quantity: 2 }] };

  // Valid partition: basket can be ordered
  test('should return 200 with the priced basket', async () => {
    model.checkCheckoutItems.mockResolvedValue({
      ok: true,
      items: [{ itemId: 5, quantity: 2, lineTotalCents: 1100 }],
      problems: [],
      totalCents: 1100,
    });
    const { res } = await run(checkCheckout, { params: { vendorId: '2' }, body });
    expect(model.checkCheckoutItems).toHaveBeenCalledWith(2, [{ itemId: 5, quantity: 2 }]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      items: [{ itemId: 5, quantity: 2, lineTotalCents: 1100 }],
      totalCents: 1100,
    });
  });

  // Error handling: sold-out item → 409 with the list of problems
  test('should return 409 with the problems', async () => {
    const problems = [{ itemId: 5, code: 'SOLD_OUT', message: 'Curry Laksa is sold out' }];
    model.checkCheckoutItems.mockResolvedValue({ ok: false, items: [], problems, totalCents: 0 });
    const { res } = await run(checkCheckout, { params: { vendorId: '2' }, body });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ problems }));
  });

  test('should return 400 for a bad basket', async () => {
    const { next } = await run(checkCheckout, { params: { vendorId: '2' }, body: {} });
    expect(errorOf(next).status).toBe(400);
  });

  test('should return 404 for an unknown vendor', async () => {
    model.checkCheckoutItems.mockResolvedValue(undefined);
    const { next } = await run(checkCheckout, { params: { vendorId: '2' }, body });
    expect(errorOf(next).status).toBe(404);
  });

  test('should pass database errors on', async () => {
    model.checkCheckoutItems.mockRejectedValue(dbDown);
    const { next } = await run(checkCheckout, { params: { vendorId: '2' }, body });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});
