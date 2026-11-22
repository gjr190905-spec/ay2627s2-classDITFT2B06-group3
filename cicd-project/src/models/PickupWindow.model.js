const pool = require('./db');
const parseId = require('../utils/parseId');

const MAX_WINDOWS_RETURNED = 100;

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
            (w."bookedCount" >= w."maxOrders") AS "isFull"
       FROM "PickupWindow" w
       JOIN "Stall" s ON s."id" = w."stallId"
      WHERE w."stallId" = $1
        AND s."isActive" = true
        AND w."startTime" > NOW()
      ORDER BY w."startTime"
      LIMIT $2`,
    [id, MAX_WINDOWS_RETURNED],
  );
  return rows;
};