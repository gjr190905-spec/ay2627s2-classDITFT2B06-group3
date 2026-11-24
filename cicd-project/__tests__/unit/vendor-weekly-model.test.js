jest.mock('../../src/models/db', () => ({ query: jest.fn() }));
const pool = require('../../src/models/db');
const { weekBounds, getWeeklyStatsForAssignedStall } = require('../../src/models/VendorWeekly.model');
beforeEach(() => jest.resetAllMocks());
test('Singapore week begins on Monday at 00:00 local time', () => {
  const { start, end } = weekBounds(new Date('2026-11-24T08:30:00Z'));
  expect(start.toISOString()).toBe('2026-11-22T16:00:00.000Z');
  expect(end.toISOString()).toBe('2026-11-29T16:00:00.000Z');
});
test('queries only assigned stall and computes 7 zero-filled day totals', async () => {
  pool.query.mockResolvedValue({rows:[{day:'2026-11-24',all_orders:3,completed_orders:2,completed_value:'16.50'}]});
  const stats = await getWeeklyStatsForAssignedStall(17,new Date('2026-11-24T08:30:00Z'));
  expect(stats.days).toHaveLength(7);expect(stats.totalCents).toBe(1650);
  expect(stats.completedOrders).toBe(2);expect(stats.averageCents).toBe(825);
  expect(pool.query.mock.calls[0][1][0]).toBe(17);
  expect(pool.query.mock.calls[0][0]).toContain('FROM vendor_weekly_order_facts');
  // created_at can be TEXT in the existing DB, so both timezone conversion and
  // range filtering must cast it to a real timestamp before PostgreSQL evaluates it.
  const sql = pool.query.mock.calls[0][0];
  expect(sql).toContain("created_at::timestamptz AT TIME ZONE 'Asia/Singapore'");
  expect(sql).toContain('created_at::timestamptz >= $2::timestamptz');
  expect(sql).toContain('created_at::timestamptz < $3::timestamptz');
});
test('rejects invalid IDs before SQL', async()=>{
  await expect(getWeeklyStatsForAssignedStall('17 OR TRUE')).rejects.toThrow();
  expect(pool.query).not.toHaveBeenCalled();
});
