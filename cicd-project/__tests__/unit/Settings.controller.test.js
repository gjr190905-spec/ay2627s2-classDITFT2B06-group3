const settingsModel = require('../../src/models/Settings.model');
const notificationModel = require('../../src/models/Notification.model');
const {
  MAX_ACTIVE_ORDERS,
  LOW_STOCK_MAX,
  validateSettings,
  getVendorSettings,
  putVendorSettings,
  getNotifications,
  readAllNotifications,
  clearAllNotifications,
} = require('../../src/controllers/Settings.controller');

// ── Mocking ──────────────────────────────────────────────
jest.mock('../../src/models/Settings.model', () => ({
  getSettings: jest.fn(),
  saveSettings: jest.fn(),
}));
jest.mock('../../src/models/Notification.model', () => ({
  listNotifications: jest.fn(),
  markAllRead: jest.fn(),
  clearNotifications: jest.fn(),
}));

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  return res;
}

async function run(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler({ query: {}, body: {}, ...req }, res, next);
  return { res, next };
}

const errorOf = (next) => next.mock.calls[0] && next.mock.calls[0][0];
const dbDown = new Error('connection lost');
const valid = () => ({
  maxActiveOrders: 10,
  notifications: { newOrder: true, soldOut: false, lowStock: true, lowStockThreshold: 3 },
});

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────
// validateSettings
// ─────────────────────────────────────────────────────────
describe('Settings.controller - validateSettings', () => {
  // Valid partition: a limit, or no limit
  test('should accept a full set of settings', () => {
    expect(validateSettings(valid())).toEqual({ settings: valid() });
  });

  test('should accept null for no limit', () => {
    expect(
      validateSettings({ ...valid(), maxActiveOrders: null }).settings.maxActiveOrders,
    ).toBeNull();
  });

  test('should drop unknown fields', () => {
    const body = { ...valid(), extra: 1 };
    body.notifications.sound = true;
    expect(validateSettings(body)).toEqual({ settings: valid() });
  });

  // Boundary: limit 1 and 200 ok; 0 and 201 not
  test.each([
    [1, true],
    [MAX_ACTIVE_ORDERS, true],
    [0, false],
    [MAX_ACTIVE_ORDERS + 1, false],
  ])('maxActiveOrders %p valid=%p (boundary)', (value, ok) => {
    expect(validateSettings({ ...valid(), maxActiveOrders: value }).error === undefined).toBe(ok);
  });

  // Boundary: threshold 1 and 50 ok; 0 and 51 not
  test.each([
    [1, true],
    [LOW_STOCK_MAX, true],
    [0, false],
    [LOW_STOCK_MAX + 1, false],
  ])('lowStockThreshold %p valid=%p (boundary)', (value, ok) => {
    const body = valid();
    body.notifications.lowStockThreshold = value;
    expect(validateSettings(body).error === undefined).toBe(ok);
  });

  // Invalid partition: wrong types and missing fields
  test.each([undefined, '10', 2.5, -1])('should reject maxActiveOrders %p', (value) => {
    expect(validateSettings({ ...valid(), maxActiveOrders: value }).error).toMatch(
      /maxActiveOrders/,
    );
  });

  test.each([undefined, null, 'on', ['x']])('should reject notifications %p', (value) => {
    expect(validateSettings({ ...valid(), notifications: value }).error).toMatch(/notifications/);
  });

  test.each(['newOrder', 'soldOut', 'lowStock'])('should require %p to be true or false', (key) => {
    const body = valid();
    body.notifications[key] = 'yes';
    expect(validateSettings(body).error).toBe(`notifications.${key} must be true or false`);
  });

  test.each([undefined, '3', 2.5])('should reject lowStockThreshold %p', (value) => {
    const body = valid();
    body.notifications.lowStockThreshold = value;
    expect(validateSettings(body).error).toMatch(/lowStockThreshold/);
  });

  test('should reject a missing body', () => {
    expect(validateSettings(undefined).error).toMatch(/maxActiveOrders/);
  });
});

// ─────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────
const handlers = [
  ['getVendorSettings', getVendorSettings, settingsModel, 'getSettings', undefined],
  ['putVendorSettings', putVendorSettings, settingsModel, 'saveSettings', valid()],
  ['getNotifications', getNotifications, notificationModel, 'listNotifications', undefined],
  ['readAllNotifications', readAllNotifications, notificationModel, 'markAllRead', undefined],
  [
    'clearAllNotifications',
    clearAllNotifications,
    notificationModel,
    'clearNotifications',
    undefined,
  ],
];

describe('Settings.controller - handlers', () => {
  // Valid partition: 200 with the model's result, never cached
  test.each(handlers)('%s should return 200', async (_name, handler, model, fn, body) => {
    model[fn].mockResolvedValue({ ok: true });
    const { res } = await run(handler, { params: { vendorId: '3' }, body });
    expect(model[fn].mock.calls[0][0]).toBe(3);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  test.each(handlers)(
    '%s should return 400 for a bad vendor id',
    async (_name, handler, model, fn, body) => {
      const { next } = await run(handler, { params: { vendorId: 'abc' }, body });
      expect(errorOf(next).status).toBe(400);
      expect(model[fn]).not.toHaveBeenCalled();
    },
  );

  test.each(handlers)(
    '%s should return 404 for an unknown vendor',
    async (_name, handler, model, fn, body) => {
      model[fn].mockResolvedValue(undefined);
      const { next } = await run(handler, { params: { vendorId: '3' }, body });
      expect(errorOf(next).status).toBe(404);
    },
  );

  test.each(handlers)(
    '%s should pass database errors on',
    async (_name, handler, model, fn, body) => {
      model[fn].mockRejectedValue(dbDown);
      const { next } = await run(handler, { params: { vendorId: '3' }, body });
      expect(next).toHaveBeenCalledWith(dbDown);
    },
  );

  // putVendorSettings passes the cleaned settings on
  test('putVendorSettings should save the validated settings', async () => {
    settingsModel.saveSettings.mockResolvedValue({ ok: true });
    await run(putVendorSettings, { params: { vendorId: '3' }, body: valid() });
    expect(settingsModel.saveSettings).toHaveBeenCalledWith(3, valid());
  });

  // Invalid partition: bad body → 400, nothing saved
  test('putVendorSettings should return 400 for a bad body', async () => {
    const { next } = await run(putVendorSettings, {
      params: { vendorId: '3' },
      body: { maxActiveOrders: 0 },
    });
    expect(errorOf(next).status).toBe(400);
    expect(errorOf(next).message).toMatch(/maxActiveOrders/);
    expect(settingsModel.saveSettings).not.toHaveBeenCalled();
  });

  // Boundary: bad vendor id is reported before a bad body
  test('putVendorSettings should report a bad vendor id first', async () => {
    const { next } = await run(putVendorSettings, { params: { vendorId: 'x' }, body: {} });
    expect(errorOf(next).message).toBe('Vendor id must be a positive integer');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
