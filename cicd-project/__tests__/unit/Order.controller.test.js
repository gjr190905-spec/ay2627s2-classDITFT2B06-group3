const model = require('../../src/models/Order.model');
const {
  CUSTOMER_NAME_MAX_LENGTH,
  WINDOW_MIN_MINUTES,
  WINDOW_MAX_MINUTES,
  validateDate,
  parseOrderNumber,
  validateNewOrder,
  validateCollection,
  getOrders,
  getStats,
  findOrderByNumber,
  getOneOrder,
  createOrder,
  changeStatus,
  collect,
} = require('../../src/controllers/Order.controller');

// ── Mocking ──────────────────────────────────────────────
jest.mock('../../src/models/Order.model', () => ({
  ...jest.requireActual('../../src/models/Order.model'),
  listOrders: jest.fn(),
  getOrder: jest.fn(),
  getOrderByNumber: jest.fn(),
  placeOrder: jest.fn(),
  advanceOrder: jest.fn(),
  collectOrder: jest.fn(),
  getOrderStats: jest.fn(),
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
const NOW = new Date('2026-11-20T04:00:00Z'); // 12:00 noon in Singapore
const minutesFromNow = (m) => new Date(NOW.getTime() + m * 60000).toISOString();
const ORDER_PARAMS = { vendorId: '3', orderId: '10' };
const order = { id: 10, orderNumber: 1042, status: 'READY', totalCents: 680 };

const validOrderBody = () => ({
  customerName: 'Alice',
  pickupWindowStart: minutesFromNow(10),
  pickupWindowEnd: minutesFromNow(25),
  items: [{ itemId: 7, quantity: 2 }],
});

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────
describe('Order.controller - validateDate', () => {
  // Valid partition: missing means today
  test.each([undefined, ''])('should treat %p as today', (raw) => {
    expect(validateDate(raw)).toEqual({ value: null });
  });

  // Valid partition / boundary: real dates, including 29 Feb in a leap year
  test.each(['2026-11-20', '2028-02-29', '2026-12-31'])('should accept %p', (raw) => {
    expect(validateDate(raw)).toEqual({ value: raw });
  });

  // Invalid partition: wrong shape, impossible dates
  test.each(['20-11-2026', '2026-1-5', 'today', ['2026-11-20']])(
    'should reject the shape of %p',
    (raw) => {
      expect(validateDate(raw).error).toMatch(/look like/);
    },
  );

  test.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-00-10'])(
    'should reject impossible date %p (boundary)',
    (raw) => {
      expect(validateDate(raw).error).toMatch(/real calendar date/);
    },
  );
});

describe('Order.controller - parseOrderNumber', () => {
  // Valid partition: numbers or digit text
  test.each([
    ['1042', 1042],
    [1042, 1042],
    [' 7 ', 7],
    ['1', 1],
    ['999999', 999999],
  ])('parseOrderNumber(%p) = %p', (raw, expected) => {
    expect(parseOrderNumber(raw)).toBe(expected);
  });

  // Boundary / invalid: 0, 7 digits, negatives, decimals, text
  test.each(['0', '1000000', '-5', '10.5', 'abc', '', null, undefined, 1.5])(
    'should reject %p',
    (raw) => {
      expect(parseOrderNumber(raw)).toBeNull();
    },
  );
});

describe('Order.controller - validateNewOrder', () => {
  // Valid partition: full body
  test('should accept a valid order', () => {
    const result = validateNewOrder(validOrderBody(), NOW);
    expect(result.input).toEqual({
      customerName: 'Alice',
      pickupWindowStart: new Date(minutesFromNow(10)),
      pickupWindowEnd: new Date(minutesFromNow(25)),
      lines: [{ itemId: 7, quantity: 2 }],
    });
  });

  // Valid partition: no name; blank name becomes null
  test.each([undefined, null, '   '])('should allow customerName %p', (name) => {
    const result = validateNewOrder({ ...validOrderBody(), customerName: name }, NOW);
    expect(result.input.customerName).toBeNull();
  });

  // Boundary: window length 5 and 120 minutes ok; 4 and 121 not
  test.each([
    [WINDOW_MIN_MINUTES, true],
    [WINDOW_MAX_MINUTES, true],
    [WINDOW_MIN_MINUTES - 1, false],
    [WINDOW_MAX_MINUTES + 1, false],
    [0, false],
    [-15, false],
  ])('window of %p minutes valid=%p (boundary)', (minutes, valid) => {
    const body = {
      ...validOrderBody(),
      pickupWindowStart: minutesFromNow(10),
      pickupWindowEnd: minutesFromNow(10 + minutes),
    };
    expect(validateNewOrder(body, NOW).error === undefined).toBe(valid);
  });

  // Boundary: start no earlier than 12 hours ago and no later than 7 days ahead
  test.each([
    [-12 * 60, true],
    [-12 * 60 - 1, false],
    [7 * 24 * 60, true],
    [7 * 24 * 60 + 1, false],
  ])('window starting %p minutes from now valid=%p (boundary)', (offset, valid) => {
    const body = {
      ...validOrderBody(),
      pickupWindowStart: minutesFromNow(offset),
      pickupWindowEnd: minutesFromNow(offset + 15),
    };
    expect(validateNewOrder(body, NOW).error === undefined).toBe(valid);
  });

  // Invalid partition: bad fields
  test.each([
    [{ customerName: 5 }, /customerName must be text/],
    [{ customerName: 'a'.repeat(CUSTOMER_NAME_MAX_LENGTH + 1) }, /60 characters/],
    [{ customerName: '<b>x</b>' }, /not allowed/],
    [{ pickupWindowStart: 'soon' }, /dates and times/],
    [{ pickupWindowEnd: 12345 }, /dates and times/],
    [{ items: [] }, /at least one item/],
    [{ items: [{ itemId: 1, quantity: 0 }] }, /quantity/],
  ])('should reject %p', (change, message) => {
    expect(validateNewOrder({ ...validOrderBody(), ...change }, NOW).error).toMatch(message);
  });

  test('should reject a missing body', () => {
    expect(validateNewOrder(undefined, NOW).error).toMatch(/dates and times/);
  });

  test('should default "now" to the current time', () => {
    const body = {
      ...validOrderBody(),
      pickupWindowStart: new Date(Date.now() + 60000).toISOString(),
      pickupWindowEnd: new Date(Date.now() + 16 * 60000).toISOString(),
    };
    expect(validateNewOrder(body).input).toBeDefined();
  });
});

describe('Order.controller - validateCollection', () => {
  const ok = { orderNumber: 1042, paymentReceived: true, foodHandedOver: true };

  // Valid partition: all three checks done
  test('should accept all three handover checks', () => {
    expect(validateCollection(ok)).toEqual({ orderNumber: 1042 });
    expect(validateCollection({ ...ok, orderNumber: '1042' })).toEqual({ orderNumber: 1042 });
  });

  // Invalid partition: each check missing (true is required, not just truthy)
  test.each([
    [{ ...ok, orderNumber: undefined }, /order number/],
    [{ ...ok, orderNumber: 'abc' }, /order number/],
    [{ ...ok, paymentReceived: false }, /payment/],
    [{ ...ok, paymentReceived: 'yes' }, /payment/],
    [{ ...ok, foodHandedOver: undefined }, /food/],
    [{ ...ok, foodHandedOver: 1 }, /food/],
  ])('should reject %p', (body, message) => {
    expect(validateCollection(body).error).toMatch(message);
  });

  test('should reject a missing body', () => {
    expect(validateCollection(undefined).error).toMatch(/order number/);
  });
});

// ─────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────
describe('Order.controller - id checks', () => {
  const vendorRoutes = [getOrders, getStats, findOrderByNumber, createOrder];
  const orderRoutes = [getOneOrder, changeStatus, collect];

  test.each([...vendorRoutes, ...orderRoutes].map((h) => [h.name, h]))(
    '%s should return 400 for a bad vendor id',
    async (_name, handler) => {
      const { next } = await run(handler, { params: { vendorId: 'x', orderId: '1' } });
      expect(errorOf(next).status).toBe(400);
    },
  );

  test.each(orderRoutes.map((h) => [h.name, h]))(
    '%s should return 400 for order id 0 (boundary)',
    async (_name, handler) => {
      const { next } = await run(handler, { params: { vendorId: '3', orderId: '0' } });
      expect(errorOf(next).message).toBe('Order id must be a positive integer');
    },
  );
});

describe('Order.controller - getOrders / getStats', () => {
  test.each([
    [getOrders, 'listOrders'],
    [getStats, 'getOrderStats'],
  ])('should return 200 with no-store', async (handler, fn) => {
    model[fn].mockResolvedValue({ date: '2026-11-20' });
    const { res } = await run(handler, {
      params: { vendorId: '3' },
      query: { date: '2026-11-20' },
    });
    expect(model[fn]).toHaveBeenCalledWith(3, '2026-11-20');
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test.each([getOrders, getStats])('should return 400 for a bad date', async (handler) => {
    const { next } = await run(handler, { params: { vendorId: '3' }, query: { date: 'x' } });
    expect(errorOf(next).status).toBe(400);
  });

  test.each([
    [getOrders, 'listOrders'],
    [getStats, 'getOrderStats'],
  ])('should return 404 for an unknown vendor', async (handler, fn) => {
    model[fn].mockResolvedValue(undefined);
    const { next } = await run(handler, { params: { vendorId: '3' } });
    expect(errorOf(next).status).toBe(404);
  });

  test.each([
    [getOrders, 'listOrders'],
    [getStats, 'getOrderStats'],
  ])('should pass database errors on', async (handler, fn) => {
    model[fn].mockRejectedValue(dbDown);
    const { next } = await run(handler, { params: { vendorId: '3' } });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Order.controller - findOrderByNumber / getOneOrder', () => {
  test('should find an order by number', async () => {
    model.getOrderByNumber.mockResolvedValue(order);
    const { res } = await run(findOrderByNumber, {
      params: { vendorId: '3', orderNumber: '1042' },
    });
    expect(model.getOrderByNumber).toHaveBeenCalledWith(3, 1042);
    expect(res.json).toHaveBeenCalledWith(order);
  });

  test('should return 400 for a bad order number', async () => {
    const { next } = await run(findOrderByNumber, {
      params: { vendorId: '3', orderNumber: 'abc' },
    });
    expect(errorOf(next).status).toBe(400);
  });

  test('should return 404 naming the missing number', async () => {
    model.getOrderByNumber.mockResolvedValue(undefined);
    const { next } = await run(findOrderByNumber, { params: { vendorId: '3', orderNumber: '9' } });
    expect(errorOf(next).status).toBe(404);
    expect(errorOf(next).message).toBe('No order #9 at your stall');
  });

  test('should return an order by id', async () => {
    model.getOrder.mockResolvedValue(order);
    const { res } = await run(getOneOrder, { params: ORDER_PARAMS });
    expect(model.getOrder).toHaveBeenCalledWith(3, 10);
    expect(res.json).toHaveBeenCalledWith(order);
  });

  test('should return 404 for an unknown order id', async () => {
    model.getOrder.mockResolvedValue(undefined);
    const { next } = await run(getOneOrder, { params: ORDER_PARAMS });
    expect(errorOf(next).status).toBe(404);
  });

  test.each([
    [findOrderByNumber, 'getOrderByNumber', { vendorId: '3', orderNumber: '1' }],
    [getOneOrder, 'getOrder', ORDER_PARAMS],
  ])('should pass database errors on', async (handler, fn, params) => {
    model[fn].mockRejectedValue(dbDown);
    const { next } = await run(handler, { params });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Order.controller - createOrder', () => {
  // createOrder checks the window against the real clock, so pin the clock to NOW
  // (otherwise these tests start failing 12 hours after the date in NOW).
  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  test('should return 201 with the new order', async () => {
    model.placeOrder.mockResolvedValue({ order });
    const { res } = await run(createOrder, { params: { vendorId: '3' }, body: validOrderBody() });
    expect(model.placeOrder).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ lines: [{ itemId: 7, quantity: 2 }] }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('should return 400 for a bad body', async () => {
    const { next } = await run(createOrder, { params: { vendorId: '3' }, body: {} });
    expect(errorOf(next).status).toBe(400);
    expect(model.placeOrder).not.toHaveBeenCalled();
  });

  test('should return 409 with the basket problems', async () => {
    const problems = [{ itemId: 7, code: 'SOLD_OUT' }];
    model.placeOrder.mockResolvedValue({ problems });
    const { res } = await run(createOrder, { params: { vendorId: '3' }, body: validOrderBody() });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ problems }));
  });

  test('should return 404 for an unknown vendor', async () => {
    model.placeOrder.mockResolvedValue(undefined);
    const { next } = await run(createOrder, { params: { vendorId: '3' }, body: validOrderBody() });
    expect(errorOf(next).status).toBe(404);
  });

  test('should pass database errors on', async () => {
    model.placeOrder.mockRejectedValue(dbDown);
    const { next } = await run(createOrder, { params: { vendorId: '3' }, body: validOrderBody() });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Order.controller - changeStatus', () => {
  // Valid partition: both allowed steps
  test.each(['PREPARING', 'READY'])('should move an order to %p', async (status) => {
    model.advanceOrder.mockResolvedValue({ order });
    const { res } = await run(changeStatus, { params: ORDER_PARAMS, body: { status } });
    expect(model.advanceOrder).toHaveBeenCalledWith(3, 10, status);
    expect(res.json).toHaveBeenCalledWith(order);
  });

  // Invalid partition: Confirmed and Collected can't be set here; lower case isn't accepted
  test.each(['CONFIRMED', 'COLLECTED', 'ready', undefined])(
    'should return 400 for status %p',
    async (status) => {
      const { next } = await run(changeStatus, { params: ORDER_PARAMS, body: { status } });
      expect(errorOf(next).status).toBe(400);
    },
  );

  test('should return 400 with no body', async () => {
    const { next } = await run(changeStatus, { params: ORDER_PARAMS, body: undefined });
    expect(errorOf(next).status).toBe(400);
  });

  // Error handling: skipping a step or going backwards
  test('should return 409 naming the current status', async () => {
    model.advanceOrder.mockResolvedValue({ currentStatus: 'CONFIRMED' });
    const { next } = await run(changeStatus, { params: ORDER_PARAMS, body: { status: 'READY' } });
    expect(errorOf(next).status).toBe(409);
    expect(errorOf(next).message).toBe("This order is Confirmed, so it can't be moved to Ready");
  });

  test('should return 404 for an unknown order', async () => {
    model.advanceOrder.mockResolvedValue(undefined);
    const { next } = await run(changeStatus, { params: ORDER_PARAMS, body: { status: 'READY' } });
    expect(errorOf(next).status).toBe(404);
  });

  test('should pass database errors on', async () => {
    model.advanceOrder.mockRejectedValue(dbDown);
    const { next } = await run(changeStatus, { params: ORDER_PARAMS, body: { status: 'READY' } });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});

describe('Order.controller - collect', () => {
  const body = { orderNumber: 1042, paymentReceived: true, foodHandedOver: true };

  test('should mark a ready order collected', async () => {
    model.collectOrder.mockResolvedValue({ order });
    const { res } = await run(collect, { params: ORDER_PARAMS, body });
    expect(model.collectOrder).toHaveBeenCalledWith(3, 10, 1042);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('should return 400 when a handover check is missing', async () => {
    const { next } = await run(collect, {
      params: ORDER_PARAMS,
      body: { ...body, paymentReceived: false },
    });
    expect(errorOf(next).status).toBe(400);
    expect(model.collectOrder).not.toHaveBeenCalled();
  });

  // Error handling: second collection, not ready, wrong number
  test('should return 409 with the original time when already collected', async () => {
    model.collectOrder.mockResolvedValue({
      alreadyCollected: { collectedAt: new Date('2026-11-20T04:05:00Z') },
    });
    const { next } = await run(collect, { params: ORDER_PARAMS, body });
    expect(errorOf(next).status).toBe(409);
    expect(errorOf(next).message).toMatch(/already collected at 12:05/);
  });

  test('should return 409 when the order is not ready', async () => {
    model.collectOrder.mockResolvedValue({ notReady: 'PREPARING' });
    const { next } = await run(collect, { params: ORDER_PARAMS, body });
    expect(errorOf(next).message).toBe(
      'This order is Preparing. Only Ready orders can be collected.',
    );
  });

  test('should return 409 when the order number does not match', async () => {
    model.collectOrder.mockResolvedValue({ numberMismatch: 1043 });
    const { next } = await run(collect, { params: ORDER_PARAMS, body });
    expect(errorOf(next).status).toBe(409);
    expect(errorOf(next).message).toMatch(/#1042 doesn't match this order \(#1043\)/);
  });

  test('should return 404 for an unknown order', async () => {
    model.collectOrder.mockResolvedValue(undefined);
    const { next } = await run(collect, { params: ORDER_PARAMS, body });
    expect(errorOf(next).status).toBe(404);
  });

  test('should pass database errors on', async () => {
    model.collectOrder.mockRejectedValue(dbDown);
    const { next } = await run(collect, { params: ORDER_PARAMS, body });
    expect(next).toHaveBeenCalledWith(dbDown);
  });
});
