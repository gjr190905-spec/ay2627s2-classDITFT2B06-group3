const pool = require('./db');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SGT = 8 * HOUR; // Singapore does not observe DST.
function weekBounds(now = new Date()) {
  const d = new Date(now.getTime() + SGT);
  if (!Number.isFinite(d.getTime())) throw new RangeError('Invalid date.');
  const offset = (d.getUTCDay() + 6) % 7; // Monday = day 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset) - SGT;
  return { start: new Date(monday), end: new Date(monday + DAY * 7) };
}

async function getWeeklyStatsForAssignedStall(stallId, now = new Date()) {
  if (!Number.isSafeInteger(stallId) || stallId <= 0) throw new RangeError('Invalid assigned stall.');
  const { start, end } = weekBounds(now);
  const paidStatuses = ['COLLECTED', 'COMPLETED'];
  // No user-supplied stallId. Rows come only from the logged-in vendor's assigned stall.
  const { rows } = await pool.query(
    `SELECT (created_at AT TIME ZONE 'Asia/Singapore')::date::text AS day,
            COUNT(*)::integer AS all_orders,
            COUNT(*) FILTER (WHERE UPPER(order_status) = ANY($4::text[]))::integer AS completed_orders,
            COALESCE(SUM(CASE WHEN UPPER(order_status) = ANY($4::text[]) THEN total_amount ELSE 0 END), 0) AS completed_value
       FROM vendor_weekly_order_facts
      WHERE stall_id = $1 AND created_at >= $2 AND created_at < $3
      GROUP BY 1 ORDER BY 1`,
    [stallId, start.toISOString(), end.toISOString(), paidStatuses],
  );
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getTime() + SGT + DAY * index).toISOString().slice(0, 10);
    const item = byDay.get(date);
    const completedOrders = Number(item?.completed_orders || 0);
    const completedValue = Number(item?.completed_value || 0);
    return { date, completedOrders, allOrders: Number(item?.all_orders || 0),
      completedValueCents: Math.round(completedValue * 100) };
  });
  const totalCents = days.reduce((sum, day) => sum + day.completedValueCents, 0);
  const completedOrders = days.reduce((sum, day) => sum + day.completedOrders, 0);
  const allOrders = days.reduce((sum, day) => sum + day.allOrders, 0);
  return {
    weekStart: days[0].date, weekEnd: days[6].date, timezone: 'Asia/Singapore',
    basis: 'Value of collected/completed orders only; not verified payment settlements',
    days, totalCents, completedOrders, allOrders,
    averageCents: completedOrders ? Math.round(totalCents / completedOrders) : 0,
  };
}
module.exports = { weekBounds, getWeeklyStatsForAssignedStall };
