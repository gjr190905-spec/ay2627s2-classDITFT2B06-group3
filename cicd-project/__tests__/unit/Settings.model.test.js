const pool = require('../../src/models/db');
const {
  DEFAULT_SETTINGS,
  toSettings,
  loadOrderingRules,
  getSettings,
  saveSettings,
} = require('../../src/models/Settings.model');
const {
  notificationsForOrder,
  createNotifications,
  listNotifications,
  markAllRead,
  clearNotifications,
} = require('../../src/models/Notification.model');

// ── Mocking ──────────────────────────────────────────────
jest.mock('../../src/models/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
}));

const settingsRow = {
  vendorId: 3,
  maxActiveOrders: 10,
  notifyNewOrder: false,
  notifySoldOut: true,
  notifyLowStock: true,
  lowStockThreshold: 5,
};
const saved = {
  maxActiveOrders: 10,
  notifications: { newOrder: false, soldOut: true, lowStock: true, lowStockThreshold: 5 },
};
const dbDown = Object.assign(new Error('connection lost'), { code: '08006' });

beforeEach(() => jest.clearAllMocks());

/** Answer the two queries of loadOrderingRules (settings row, in-progress count). */
function answerRules(row, count) {
  pool.query.mockImplementation((sql) => {
    if (sql.includes('FROM "VendorSettings"')) return Promise.resolve({ rows: row ? [row] : [] });
    if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count }] });
    return Promise.resolve({ rows: [{ id: 3 }] });
  });
}

// ─────────────────────────────────────────────────────────
// Settings.model
// ─────────────────────────────────────────────────────────
describe('Settings.model - toSettings', () => {
  // Boundary: no row yet → the defaults (a fresh copy each time)
  test('should give the defaults when the vendor has no row', () => {
    const settings = toSettings(undefined);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    settings.notifications.newOrder = false;
    expect(DEFAULT_SETTINGS.notifications.newOrder).toBe(true);
  });

  // Valid partition: a saved row
  test('should map a saved row', () => {
    expect(toSettings(settingsRow)).toEqual(saved);
  });
});

describe('Settings.model - loadOrderingRules', () => {
  // Valid partition: settings plus the count of Confirmed + Preparing orders
  test('should combine the settings with the orders in progress', async () => {
    answerRules(settingsRow, 4);

    await expect(loadOrderingRules(pool, 3)).resolves.toEqual({ ...saved, activeOrders: 4 });
    const countCall = pool.query.mock.calls.find(([sql]) => sql.includes('COUNT(*)'));
    expect(countCall[1]).toEqual([3, ['CONFIRMED', 'PREPARING']]);
  });

  // Valid partition: works with a transaction client too
  test('should use whichever client it is given', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ count: 0 }] }) };
    await loadOrderingRules(client, 3);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('Settings.model - getSettings', () => {
  test('should return the settings and current load', async () => {
    answerRules(null, 2);
    await expect(getSettings(3)).resolves.toEqual({ ...DEFAULT_SETTINGS, activeOrders: 2 });
  });

  test('should return undefined for an unknown vendor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(getSettings(99)).resolves.toBeUndefined();
  });
});

describe('Settings.model - saveSettings', () => {
  // Valid partition: upsert all fields, then read them back
  test('should save every field and return the result', async () => {
    answerRules(settingsRow, 1);

    const result = await saveSettings(3, saved);

    expect(result).toEqual({ ...saved, activeOrders: 1 });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT ("vendorId") DO UPDATE');
    expect(params).toEqual([3, 10, false, true, true, 5]);
  });

  // Valid partition: no limit is saved as NULL
  test('should save "no limit" as null', async () => {
    answerRules(null, 0);
    await saveSettings(3, { ...saved, maxActiveOrders: null });
    expect(pool.query.mock.calls[0][1][1]).toBeNull();
  });

  // Error handling: unknown vendor (foreign key) vs other errors
  test('should return undefined for an unknown vendor', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    await expect(saveSettings(99, saved)).resolves.toBeUndefined();
  });

  test('should pass other database errors on', async () => {
    pool.query.mockRejectedValueOnce(dbDown);
    await expect(saveSettings(3, saved)).rejects.toBe(dbDown);
  });
});

// ─────────────────────────────────────────────────────────
// Notification.model
// ─────────────────────────────────────────────────────────
describe('Notification.model - notificationsForOrder', () => {
  const order = {
    id: 11,
    orderNumber: 1043,
    totalCents: 910,
    itemCount: 3,
    windowLabel: '12:00 pm – 12:15 pm',
  };
  const allOn = { newOrder: true, soldOut: true, lowStock: true, lowStockThreshold: 3 };
  const item = (before, after) => ({ menuItemId: 7, name: 'Mee Siam', before, after });

  // Valid partition: a new order with nothing counted
  test('should announce a new order', () => {
    expect(notificationsForOrder(order, [], allOn)).toEqual([
      {
        type: 'NEW_ORDER',
        message: 'New order #1043 for 12:00 pm – 12:15 pm (3 items, $9.10)',
        orderId: 11,
        menuItemId: null,
      },
    ]);
  });

  test('should say "1 item" for a single portion', () => {
    const [note] = notificationsForOrder({ ...order, itemCount: 1 }, [], allOn);
    expect(note.message).toContain('(1 item, $9.10)');
  });

  // Boundary: reaching 0 → sold out (not low stock)
  test('should report sold out when the last ones go', () => {
    const notes = notificationsForOrder(order, [item(2, 0)], allOn);
    expect(notes.map((n) => n.type)).toEqual(['NEW_ORDER', 'SOLD_OUT']);
    expect(notes[1]).toMatchObject({
      message: 'Mee Siam is sold out (last one went in order #1043)',
      menuItemId: 7,
    });
  });

  // Boundary: low stock only when crossing the threshold (4 → 3), not when already low (3 → 2)
  test.each([
    [4, 3, true],
    [10, 1, true],
    [3, 2, false],
    [5, 4, false],
  ])('from %p to %p left → low-stock note %p (boundary)', (before, after, expected) => {
    const types = notificationsForOrder(order, [item(before, after)], allOn).map((n) => n.type);
    expect(types.includes('LOW_STOCK')).toBe(expected);
  });

  // Valid partition: switched-off types are never created
  test('should create nothing the vendor has switched off', () => {
    const allOff = { newOrder: false, soldOut: false, lowStock: false, lowStockThreshold: 3 };
    expect(notificationsForOrder(order, [item(2, 0), item(5, 1)], allOff)).toEqual([]);
  });
});

describe('Notification.model - createNotifications', () => {
  test('should insert all notes in one statement', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await createNotifications(db, 3, [
      { type: 'NEW_ORDER', message: 'a', orderId: 11, menuItemId: null },
      { type: 'SOLD_OUT', message: 'b', orderId: 11, menuItemId: 7 },
    ]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)');
    expect(params).toEqual([3, 'NEW_ORDER', 'a', 11, null, 3, 'SOLD_OUT', 'b', 11, 7]);
  });

  // Boundary: nothing to save → no query
  test('should do nothing for an empty list', async () => {
    const db = { query: jest.fn() };
    await createNotifications(db, 3, []);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('Notification.model - list, read and clear', () => {
  test('should list the latest notifications and the unread count', async () => {
    const note = { id: 1, type: 'NEW_ORDER', message: 'x', readAt: null };
    pool.query.mockImplementation((sql) => {
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: 1 }] });
      if (sql.includes('ORDER BY')) return Promise.resolve({ rows: [note] });
      return Promise.resolve({ rows: [{ id: 3 }] });
    });

    await expect(listNotifications(3)).resolves.toEqual({ unreadCount: 1, notifications: [note] });
    const listSql = pool.query.mock.calls.find(([sql]) => sql.includes('ORDER BY'))[0];
    expect(listSql).toContain('ORDER BY "createdAt" DESC, "id" DESC');
    expect(listSql).toContain('LIMIT 50');
  });

  test('should mark only unread notifications as read', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3 }] }).mockResolvedValueOnce({ rowCount: 4 });
    await expect(markAllRead(3)).resolves.toEqual({ unreadCount: 0, marked: 4 });
    expect(pool.query.mock.calls[1][0]).toContain('"readAt" IS NULL');
  });

  test('should clear all notifications', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3 }] }).mockResolvedValueOnce({ rowCount: 6 });
    await expect(clearNotifications(3)).resolves.toEqual({ unreadCount: 0, deleted: 6 });
  });

  // Error handling: unknown vendor for each action
  test.each([listNotifications, markAllRead, clearNotifications])(
    '%p should return undefined for an unknown vendor',
    async (fn) => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(fn(99)).resolves.toBeUndefined();
      expect(pool.query).toHaveBeenCalledTimes(1);
    },
  );
});
