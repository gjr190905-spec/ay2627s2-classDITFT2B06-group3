const pool = require('./db');

module.exports.getAvailablePickupWindows = async function getAvailablePickupWindows(stallId) {
  const { rows } = await pool.query(
    `SELECT
       "id" AS window_id,
       "stallId" AS stall_id,
       "startTime" AS start_time,
       "endTime" AS end_time,
       "maxOrders" AS capacity,
       "bookedCount" AS booked_count,
       "maxOrders" - "bookedCount" AS available_slots
     FROM "PickupWindow"
     WHERE "stallId" = $1
       AND "isActive" = TRUE
       AND "startTime" > CURRENT_TIMESTAMP
       AND "bookedCount" < "maxOrders"
     ORDER BY "startTime" ASC`,
    [stallId]
  );

  return rows;
};