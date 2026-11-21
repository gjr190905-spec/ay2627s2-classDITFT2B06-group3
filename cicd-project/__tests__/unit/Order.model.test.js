const pool = require('../../src/models/db');
const {
  toOrder,
  groupByPickupWindow,
  listOrders,
  getOrder,
  getOrderByNumber,
  placeOrder,
  advanceOrder,
  collectOrder,
  getOrderStats,
} = require('../../src/models/Order.model');

// ── Mocking ──────────────────────────────────────────────
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

// Notifications are saved through Notification.model; the rules themselves stay real
jest.mock('../../src/models/Notification.model', () => ({
  ...jest.requireActual('../../src/models/Notification.model'),
  createNotifications: jest.fn(),
}));
const { createNotifications } = require('../../src/models/Notification.model');

const T = (hhmm) => new Date(`2026-11-20T${hhmm}:00+08:00`);

const orderRow = (overrides = {}) => ({
  id: 10,
  vendorId: 3,
  orderNumber: 1042,
  customerName: 'Alice',
  status: 'CONFIRMED',
  pickupWindowStart: T('12:00'),
  pickupWindowEnd: T('12:15'),
  totalCents: 680,
  createdAt: T('11:00'),
  preparingAt: null,
  readyAt: null,
  collectedAt: null,
  ...overrides,
});
const itemRow = { orderId: 10, menuItemId: 7, name: 'Kopi', unitPriceCents: 150, quantity: 2 };

const dbDown = new Error('connection lost');

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(client);
  loadOrderingRules.mockResolvedValue(NO_LIMIT);
});

/** Answer pool.query with the given results in order. */
function poolAnswers(...results) {
  results.forEach((r) => pool.query.mockResolvedValueOnce(r));
}

/** Answer client.query: BEGIN/COMMIT/ROLLBACK get nothing, the rest in order. */
function clientAnswers(...results) {
  const queue = [...results];
  client.query.mockImplementation((sql) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return Promise.resolve({ rows: [] });
    const next = queue.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
}
const clientSql = () => client.query.mock.calls.map(([sql]) => sql.trim());

// ── Pure helpers ─────────────────────────────────────────
describe('Order.model - toOrder', () => {
  // Valid partition: not ready yet → readyOnTime null; line totals worked out
  test('should map an order and its items', () => {
    const order = toOrder(orderRow(), [itemRow]);
    expect(order).toMatchObject({
      id: 10,
      orderNumber: 1042,
      status: 'CONFIRMED',
      totalCents: 680,
      readyOnTime: null,
      items: [
        { menuItemId: 7, name: 'Kopi', unitPriceCents: 150, quantity: 2, lineTotalCents: 300 },
      ],
    });
  });

  // Boundary: ready exactly at the window end counts as on time; one second later is late
  test.each([
    ['12:15:00', true],
    ['12:15:01', false],
    ['11:58:00', true],
  ])('ready at %p → readyOnTime %p (boundary)', (time, onTime) => {
    const row = orderRow({ status: 'READY', readyAt: new Date(`2026-11-20T${time}+08:00`) });
    expect(toOrder(row, []).readyOnTime).toBe(onTime);
  });
});

describe('Order.model - groupByPickupWindow', () => {
  const o = (start, end, n) => ({
    orderNumber: n,
    pickupWindowStart: T(start),
    pickupWindowEnd: T(end),
  });

  // Valid partition: orders in the same window go together, in order
  test('should group consecutive orders with the same window', () => {
    const groups = groupByPickupWindow([
      o('11:30', '11:45', 1),
      o('11:30', '11:45', 2),
      o('12:00', '12:15', 3),
    ]);
    expect(groups.map((g) => [g.start, g.orders.map((x) => x.orderNumber)])).toEqual([
      [T('11:30'), [1, 2]],
      [T('12:00'), [3]],
    ]);
  });

  // Boundary: same start, different end → two windows
  test('should keep windows with the same start but a different end apart', () => {
    const groups = groupByPickupWindow([o('12:00', '12:15', 1), o('12:00', '12:30', 2)]);
    expect(groups).toHaveLength(2);
  });

  // Boundary: no orders
  test('should return no windows for no orders', () => {
    expect(groupByPickupWindow([])).toEqual([]);
  });
});

// ── Reading orders ───────────────────────────────────────
describe('Order.model - listOrders', () => {
  // Valid partition: today, grouped, items attached
  test('should return the day and its windows', async () => {
    poolAnswers({ rows: [{ day: '2026-11-20' }] }, { rows: [orderRow()] }, { rows: [itemRow] });

    const result = await listOrders(3, null);

    expect(result.date).toBe('2026-11-20');
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].orders[0].items).toHaveLength(1);
    const [daySql, dayParams] = pool.query.mock.calls[0];
    expect(daySql).toContain("AT TIME ZONE 'Asia/Singapore'");
    expect(dayParams).toEqual([3, null]);
    const [ordersSql, ordersParams] = pool.query.mock.calls[1];
    expect(ordersSql).toContain(
      'ORDER BY o."pickupWindowStart", o."pickupWindowEnd", o."orderNumber"',
    );
    expect(ordersParams).toEqual([3, '2026-11-20']);
  });

  // Boundary: no orders → no items query
  test('should return no windows on a day without orders', async () => {
    poolAnswers({ rows: [{ day: '2026-11-19' }] }, { rows: [] });
    await expect(listOrders(3, '2026-11-19')).resolves.toEqual({ date: '2026-11-19', windows: [] });
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  // Valid partition: an order without item rows still gets an empty list
  test('should give an order with no item rows an empty item list', async () => {
    poolAnswers({ rows: [{ day: '2026-11-20' }] }, { rows: [orderRow()] }, { rows: [] });
    const result = await listOrders(3, null);
    expect(result.windows[0].orders[0].items).toEqual([]);
  });

  test('should return undefined for an unknown vendor', async () => {
    poolAnswers({ rows: [] });
    await expect(listOrders(99, null)).resolves.toBeUndefined();
  });

  test('should pass database errors on', async () => {
    pool.query.mockRejectedValue(dbDown);
    await expect(listOrders(3, null)).rejects.toBe(dbDown);
  });
});

describe('Order.model - getOrder / getOrderByNumber', () => {
  test('should read one order by id, scoped to the vendor', async () => {
    poolAnswers({ rows: [orderRow()] }, { rows: [itemRow] });
    const order = await getOrder(3, 10);
    expect(order.orderNumber).toBe(1042);
    expect(pool.query.mock.calls[0][1]).toEqual([10, 3]);
  });

  test('should read one order by number, scoped to the vendor', async () => {
    poolAnswers({ rows: [orderRow()] }, { rows: [itemRow] });
    await getOrderByNumber(3, 1042);
    expect(pool.query.mock.calls[0][1]).toEqual([3, 1042]);
  });

  test('should return undefined when not found', async () => {
    poolAnswers({ rows: [] });
    await expect(getOrderByNumber(3, 1)).resolves.toBeUndefined();
  });
});

// ── placeOrder ───────────────────────────────────────────
describe('Order.model - placeOrder', () => {
  const input = {
    customerName: 'Alice',
    pickupWindowStart: T('12:00'),
    pickupWindowEnd: T('12:15'),
    lines: [{ itemId: 7, quantity: 2 }],
  };
  const menuRow = { id: 7, name: 'Kopi', priceCents: 150, quantityLeft: 5, isSoldOut: false };

  // Valid partition: saved, stock reduced, next number used
  test('should lock, reduce stock, number and save the order', async () => {
    clientAnswers(
      { rows: [{ isOpen: true }] }, // lock vendor
      { rows: [menuRow] }, // lock items
      { rows: [] }, // reduce stock
      { rows: [{ orderNumber: 1043 }] }, // next number
      { rows: [{ id: 11 }] }, // insert order
      { rows: [] }, // insert items
      { rows: [orderRow({ id: 11, orderNumber: 1043, totalCents: 300 })] }, // load order
      { rows: [{ ...itemRow, orderId: 11 }] }, // load items
    );

    const result = await placeOrder(3, input);

    expect(result.order).toMatchObject({ id: 11, orderNumber: 1043 });
    const sql = clientSql();
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('FOR UPDATE');
    expect(sql[2]).toContain('FOR UPDATE');
    expect(sql[3]).toContain('"quantityLeft" = "quantityLeft" - $2');
    expect(client.query.mock.calls[3][1]).toEqual([7, 2]);
    expect(client.query.mock.calls[5][1]).toEqual([3, 1043, 'Alice', T('12:00'), T('12:15'), 300]);
    expect(client.query.mock.calls[6][1]).toEqual([11, 7, 'Kopi', 150, 2]);
    expect(sql[sql.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  // Error handling: basket problem → nothing saved, rolled back
  test('should return the problems and roll back when an item is sold out', async () => {
    clientAnswers({ rows: [{ isOpen: true }] }, { rows: [{ ...menuRow, isSoldOut: true }] });

    const result = await placeOrder(3, input);

    expect(result.problems[0].code).toBe('SOLD_OUT');
    expect(clientSql()).toContain('ROLLBACK');
    expect(clientSql().some((s) => s.startsWith('INSERT'))).toBe(false);
  });

  test('should refuse when the stall is closed', async () => {
    clientAnswers({ rows: [{ isOpen: false }] }, { rows: [menuRow] });
    const result = await placeOrder(3, input);
    expect(result.problems[0].code).toBe('STALL_CLOSED');
  });

  // Error handling: the vendor's "orders at once" limit, read with the stall row locked
  test('should refuse when the stall is at its order limit', async () => {
    loadOrderingRules.mockResolvedValue({ ...NO_LIMIT, maxActiveOrders: 3, activeOrders: 3 });
    clientAnswers({ rows: [{ isOpen: true }] }, { rows: [menuRow] });

    const result = await placeOrder(3, input);

    expect(result.problems[0].code).toBe('STALL_BUSY');
    expect(loadOrderingRules).toHaveBeenCalledWith(client, 3);
    expect(clientSql()).toContain('ROLLBACK');
  });

  // Valid partition: notifications for the order, using stock before and after
  test('should create the notifications the vendor has switched on', async () => {
    clientAnswers(
      { rows: [{ isOpen: true }] },
      { rows: [menuRow] }, // 5 left, order takes 2 → 3 left (= threshold 3)
      { rows: [] },
      { rows: [{ orderNumber: 1043 }] },
      { rows: [{ id: 11 }] },
      { rows: [] },
      { rows: [orderRow({ id: 11, orderNumber: 1043, totalCents: 300 })] },
      { rows: [{ ...itemRow, orderId: 11 }] },
    );

    await placeOrder(3, input);

    const [db, vendorId, list] = createNotifications.mock.calls[0];
    expect(db).toBe(client);
    expect(vendorId).toBe(3);
    expect(list.map((n) => n.type)).toEqual(['NEW_ORDER', 'LOW_STOCK']);
    expect(list[0].message).toBe('New order #1043 for 12:00 pm – 12:15 pm (2 items, $3.00)');
    expect(list[1]).toMatchObject({ message: 'Only 3 Kopi left', menuItemId: 7, orderId: 11 });
  });

  test('should return undefined for an unknown vendor', async () => {
    clientAnswers({ rows: [] });
    await expect(placeOrder(99, input)).resolves.toBeUndefined();
    expect(clientSql()).toContain('ROLLBACK');
  });

  test('should roll back and pass errors on', async () => {
    clientAnswers(dbDown);
    await expect(placeOrder(3, input)).rejects.toBe(dbDown);
    expect(clientSql()).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ── advanceOrder ─────────────────────────────────────────
describe('Order.model - advanceOrder', () => {
  // Valid partition: each step sets its own timestamp and needs the previous status
  test.each([
    ['PREPARING', 'preparingAt', 'CONFIRMED'],
    ['READY', 'readyAt', 'PREPARING'],
  ])('should move to %p, recording %p', async (next, column, previous) => {
    poolAnswers({ rows: [{ id: 10 }] }, { rows: [orderRow({ status: next })] }, { rows: [] });

    const result = await advanceOrder(3, 10, next);

    expect(result.order.status).toBe(next);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain(`"${column}" = NOW()`);
    expect(sql).toContain('"status" = $4');
    expect(params).toEqual([10, 3, next, previous]);
  });

  // Error handling: wrong current status
  test('should report the current status when the step is not allowed', async () => {
    poolAnswers({ rows: [] }, { rows: [{ status: 'COLLECTED' }] });
    await expect(advanceOrder(3, 10, 'READY')).resolves.toEqual({ currentStatus: 'COLLECTED' });
  });

  test('should return undefined for an unknown order', async () => {
    poolAnswers({ rows: [] }, { rows: [] });
    await expect(advanceOrder(3, 10, 'READY')).resolves.toBeUndefined();
  });
});

// ── collectOrder ─────────────────────────────────────────
describe('Order.model - collectOrder', () => {
  // Valid partition: ready + matching number → collected
  test('should collect a ready order with a matching number', async () => {
    poolAnswers(
      { rows: [{ id: 10 }] },
      { rows: [orderRow({ status: 'COLLECTED', collectedAt: T('12:10') })] },
      { rows: [] },
    );

    const result = await collectOrder(3, 10, 1042);

    expect(result.order.status).toBe('COLLECTED');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain(`"status" = 'READY' AND "orderNumber" = $3`);
    expect(params).toEqual([10, 3, 1042]);
  });

  // Error handling: each reason the update matched nothing
  const ready = { preparingAt: T('11:50'), readyAt: T('11:58') };
  test.each([
    [orderRow({ status: 'COLLECTED', ...ready, collectedAt: T('12:05') }), 'alreadyCollected'],
    [orderRow({ status: 'PREPARING', preparingAt: T('11:50') }), 'notReady'],
    [orderRow({ status: 'READY', ...ready }), 'numberMismatch'],
  ])('should explain why it was not collected (%#)', async (row, key) => {
    poolAnswers({ rows: [] }, { rows: [row] }, { rows: [] });
    const result = await collectOrder(3, 10, 9999);
    expect(Object.keys(result)).toEqual([key]);
  });

  test('should return undefined for an unknown order', async () => {
    poolAnswers({ rows: [] }, { rows: [] });
    await expect(collectOrder(3, 10, 1042)).resolves.toBeUndefined();
  });
});

// ── getOrderStats ────────────────────────────────────────
describe('Order.model - getOrderStats', () => {
  const totals = {
    total: 5,
    confirmed: 1,
    preparing: 1,
    ready: 1,
    collected: 2,
    collectedCents: 1000,
    toCollectCents: 300,
    onTime: 2,
    late: 1,
  };

  function answerStats(t = totals) {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('to_char(COALESCE'))
        return Promise.resolve({ rows: [{ day: '2026-11-20' }] });
      if (sql.includes('COUNT(*) FILTER')) return Promise.resolve({ rows: [t] });
      if (sql.includes('GROUP BY 1, 2')) return Promise.resolve({ rows: [{ orders: 5 }] });
      if (sql.includes('SUM(i."quantity")'))
        return Promise.resolve({ rows: [{ name: 'Kopi', quantity: 4 }] });
      return Promise.resolve({ rows: [{ date: '2026-11-20', orders: 5, collectedCents: 1000 }] });
    });
  }

  // Valid partition: figures assembled, on-time rate worked out
  test('should assemble the dashboard figures', async () => {
    answerStats();

    const stats = await getOrderStats(3, null);

    expect(stats).toEqual({
      date: '2026-11-20',
      counts: { total: 5, CONFIRMED: 1, PREPARING: 1, READY: 1, COLLECTED: 2 },
      collectedCents: 1000,
      toCollectCents: 300,
      readyOnTime: { onTime: 2, late: 1, rate: 2 / 3 },
      byWindow: [{ orders: 5 }],
      topItems: [{ name: 'Kopi', quantity: 4 }],
      last7Days: [{ date: '2026-11-20', orders: 5, collectedCents: 1000 }],
    });
  });

  // Boundary: nothing ready yet → rate is null (not 0% and not a division by zero)
  test('should give a null rate when nothing has been ready yet (boundary)', async () => {
    answerStats({ ...totals, onTime: 0, late: 0 });
    const stats = await getOrderStats(3, null);
    expect(stats.readyOnTime.rate).toBeNull();
  });

  test('should return undefined for an unknown vendor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(getOrderStats(99, null)).resolves.toBeUndefined();
  });
});
