// Read-only live PostgreSQL check for weekly sales with TEXT or timestamp dates.
// Run: node --env-file=.env.dev scripts/check-vendor-weekly-live.cjs
const pool = require('../src/models/db');
const { getWeeklyStatsForAssignedStall } = require('../src/models/VendorWeekly.model');

(async () => {
  const { rows: columns } = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'vendor_weekly_order_facts'
      AND column_name IN ('created_at', 'stall_id', 'order_status', 'total_amount')
    ORDER BY column_name
  `);
  console.log('Weekly sales view column types:', columns.map(x => `${x.column_name}:${x.data_type}`).join(', '));
  const { rows } = await pool.query(`
    SELECT stall_id FROM vendor_weekly_order_facts
    WHERE stall_id IS NOT NULL
    GROUP BY stall_id ORDER BY COUNT(*) DESC, stall_id LIMIT 1
  `);
  if (!rows.length) {
    throw new Error('No stall-associated orders to verify in development DB; add test fixture data before claiming full live verification.');
  }
  const stallId = Number(rows[0].stall_id);
  if (!Number.isSafeInteger(stallId) || stallId <= 0) throw new Error('Invalid stall ID in database.');
  const stats = await getWeeklyStatsForAssignedStall(stallId);
  if (stats.days.length !== 7 || !Number.isSafeInteger(stats.totalCents) || stats.totalCents < 0) {
    throw new Error('Invalid weekly stats response.');
  }
  console.log('PASS: weekly statistics query returned seven days from PostgreSQL.');
  console.log(JSON.stringify({ stallId, weekStart: stats.weekStart,
    weekEnd: stats.weekEnd, completedOrders: stats.completedOrders,
    totalCents: stats.totalCents, days: stats.days.length }, null, 2));
})().catch(e => {
  console.error('FAIL: weekly statistics live query:', e.code || '', e.message);
  process.exitCode = 1;
}).finally(() => pool.end());
