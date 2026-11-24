const pool = require('./db');

// Retrieve available pickup windows for a stall
module.exports.getAvailablePickupWindows = async function getAvailablePickupWindows(stallId) {
  const { rows } = await pool.query(
    `SELECT
       window_id,
       stall_id,
       start_time,
       end_time,
       capacity,
       booked_count,
       capacity - booked_count AS available_slots
     FROM pickup_windows
     WHERE stall_id = $1
     AND is_active = TRUE
     AND start_time > CURRENT_TIMESTAMP
     AND booked_count < capacity
     ORDER BY start_time ASC`,
    [stallId]
  );

  return rows;
};