const pool = require('./db');
const parseId = require('../utils/parseId');

const MAX_WINDOWS_RETURNED = 100;
const WINDOW_DURATION_MINUTES = 5;
const WINDOW_MAX_ORDERS = 5;
const GENERATE_HOURS_AHEAD = 24 * 7; // one week of slots

// ── Auto-generation ──────────────────────────────────────
async function generateWindowsForStall(stallId) {
  await pool.query(
    `INSERT INTO "PickupWindow" ("stallId", "startTime", "endTime", "maxOrders", "bookedCount")
     SELECT $1, slot, slot + ($2 || ' minutes')::interval, $3, 0
       FROM generate_series(
              date_trunc('hour', NOW()) + interval '1 hour',
              date_trunc('hour', NOW()) + ($4 || ' hours')::interval,
              ($2 || ' minutes')::interval
            ) AS slot
     ON CONFLICT DO NOTHING`,
    [stallId, WINDOW_DURATION_MINUTES, WINDOW_MAX_ORDERS, GENERATE_HOURS_AHEAD],
  );
}

// ── Public API ───────────────────────────────────────────
module.exports.getUpcomingWindowsByStallId = async function getUpcomingWindowsByStallId(stallId) {
  const id = parseId(stallId);
  if (id === null) {
    return null;
  }

  const { rows } = await pool.query(
    `SELECT w."id",
            w."startTime",
            w."endTime",
            (w."maxOrders" - w."bookedCount") AS "spacesLeft",
            (w."bookedCount" >= w."maxOrders")  AS "isFull"
       FROM "PickupWindow" w
       JOIN "Vendor" v ON v."id" = w."stallId"
      WHERE w."stallId" = $1
        AND v."isActive" = true
        AND w."isActive" = true
        AND w."startTime" > NOW()
      ORDER BY w."startTime"
      LIMIT $2`,
    [id, MAX_WINDOWS_RETURNED],
  );

  // If no upcoming windows exist, generate them and fetch again.
  // This means no one ever has to run migration:reset just to get slots.
  if (rows.length === 0) {
    await generateWindowsForStall(id);

    const { rows: fresh } = await pool.query(
      `SELECT w."id",
              w."startTime",
              w."endTime",
              (w."maxOrders" - w."bookedCount") AS "spacesLeft",
              (w."bookedCount" >= w."maxOrders")  AS "isFull"
         FROM "PickupWindow" w
         JOIN "Vendor" v ON v."id" = w."stallId"
        WHERE w."stallId" = $1
          AND v."isActive" = true
          AND w."isActive" = true
          AND w."startTime" > NOW()
        ORDER BY w."startTime"
        LIMIT $2`,
      [id, MAX_WINDOWS_RETURNED],
    );
    return fresh;
  }

  return rows;
};