'use strict';
const fs = require('node:fs');
const path = require('node:path');
jest.mock('../../src/models/db', () => ({ query: jest.fn() }));
const pool = require('../../src/models/db');
const model = require('../../src/models/CustomerNotifications.model');

beforeEach(() => jest.clearAllMocks());

const row = {
  id: '9', order_id: '6', event_type: 'ORDER_PLACED',
  title: 'Order placed', message: 'Placed successfully',
  created_at: '2026-11-26T02:30:00Z', read_at: null,
};

test('valid IDs only allow positive safe integers', () => {
  expect(model.validId('18')).toBe(18);
  for (const bad of [0, -1, 'abc', '0', '1.5', Number.MAX_SAFE_INTEGER+1]) expect(model.validId(bad)).toBe(null);
});

test('notifications convert database IDs and never expose customer identity', () => {
  const result = model.toPublic(row);
  expect(result).toMatchObject({id:9,orderId:6,type:'ORDER_PLACED',readAt:null});
  expect(result).not.toHaveProperty('customerId');
});

test('list is scoped to authenticated owner, hides dismissed, and returns unread count', async () => {
  pool.query.mockResolvedValueOnce({rows:[row]});
  pool.query.mockResolvedValueOnce({rows:[{unread:1}]});
  const result = await model.list(41);
  expect(result.unreadCount).toBe(1);
  expect(result.notifications).toHaveLength(1);
  expect(pool.query).toHaveBeenCalledTimes(2);
  for(const [sql, params] of pool.query.mock.calls){
    expect(sql).toMatch(/customer_id\s*=\s*\$1/i);
    expect(sql).toMatch(/dismissed_at IS NULL/i);
    expect(params).toEqual([41]);
  }
});

test('unauthenticated list rejects before any database query', async () => {
  await expect(model.list(null)).rejects.toMatchObject({status:401});
  expect(pool.query).not.toHaveBeenCalled();
});

test('mark read changes only a notification owned by this customer', async () => {
  pool.query.mockResolvedValue({rows:[{...row,read_at:'2026-11-26T02:34:00Z'}]});
  const result=await model.markRead(41,9);
  expect(result.notification.readAt).not.toBeNull();
  const [sql, params] = pool.query.mock.calls[0];
  expect(sql).toMatch(/SET read_at = COALESCE\(read_at, NOW\(\)\)/i);
  expect(sql).toMatch(/id = \$1 AND customer_id = \$2 AND dismissed_at IS NULL/i);
  expect(params).toEqual([9,41]);
});

test('mark read returns 404 for another customer or dismissed notification', async () => {
  pool.query.mockResolvedValue({rows:[]});
  await expect(model.markRead(42,9)).rejects.toMatchObject({status:404});
});

test('dismiss persists dismissed_at and checks ownership', async () => {
  pool.query.mockResolvedValue({rows:[{id:'9'}]});
  expect(await model.dismiss(41,9)).toEqual({ok:true,dismissedId:9});
  const [sql, params] = pool.query.mock.calls[0];
  expect(sql).toMatch(/SET dismissed_at = NOW\(\)/i);
  expect(sql).toMatch(/id = \$1 AND customer_id = \$2 AND dismissed_at IS NULL/i);
  expect(params).toEqual([9,41]);
});

test('dismiss returns 404 for another customer or previously dismissed notification', async () => {
  pool.query.mockResolvedValue({rows:[]});
  await expect(model.dismiss(999,9)).rejects.toMatchObject({status:404});
});

test('read and dismiss reject invalid notification IDs without querying the database', async () => {
  await expect(model.dismiss(41, 'abc')).rejects.toMatchObject({status:400});
  await expect(model.markRead(41, -3)).rejects.toMatchObject({status:400});
  expect(pool.query).not.toHaveBeenCalled();
});

test('new order notification uses the same transaction client as order creation', async () => {
  const client = { query: jest.fn().mockResolvedValue({rows:[]}) };
  await model.insertOrderPlaced(client, {
    customerId:41,orderId:6,orderNumber:'ML-TEST-006',stallName:'Foodgonomy',
  });
  expect(pool.query).not.toHaveBeenCalled();
  expect(client.query).toHaveBeenCalledTimes(1);
  const [sql, params] = client.query.mock.calls[0];
  expect(sql).toMatch(/ON CONFLICT \(customer_id, order_id, event_type\) DO NOTHING/i);
  expect(params[0]).toBe(41);
  expect(params[1]).toBe(6);
  expect(params[3]).toContain('Foodgonomy');
  expect(params[3]).toContain('Pay at pickup');
});

test('invalid new order notification cannot write', async () => {
  const client={query:jest.fn()};
  await expect(model.insertOrderPlaced(client, {customerId:null,orderId:0})).rejects.toMatchObject({status:400});
  expect(client.query).not.toHaveBeenCalled();
});

test('frontend exposes notification bell, mark-read, dismiss and refresh', () => {
  const base=path.resolve(__dirname,'../../src/public/prototype-exact');
  const app=fs.readFileSync(path.join(base,'app.js'),'utf8');
  const bridge=fs.readFileSync(path.join(base,'api-bridge.js'),'utf8');
  for(const text of ['data-notif-read','data-notif-dismiss','refreshOrderNotifications','roleNotificationSection']) {
    expect(app).toContain(text);
  }
  expect(bridge).toContain("path==='/api/notifications'");
  expect(bridge).toContain('read|dismiss');
  expect(bridge).toContain('/api/activity-notifications');
});

test('transactional checkout inserts notification BEFORE COMMIT', () => {
  const file=path.resolve(__dirname,'../../src/models/LiveCheckout.model.js');
  const src=fs.readFileSync(file,'utf8');
  expect(src).toContain('insertOrderPlaced(client,');
  expect(src.indexOf('await insertOrderPlaced(client,')).toBeLessThan(src.indexOf("await client.query('COMMIT')"));
});

test('secured notification routes require customer auth and CSRF for changes', () => {
  const src=fs.readFileSync(path.resolve(__dirname,'../../src/routers/CustomerNotifications.router.js'),'utf8');
  expect(src).toContain("router.use(authenticate, requireRole('customer'))");
  expect(src).toContain('requireSameOrigin, requireCsrf');
  expect(src).toContain("router.post('/:id/dismiss'");
  expect(src).toContain("router.post('/:id/read'");
});
