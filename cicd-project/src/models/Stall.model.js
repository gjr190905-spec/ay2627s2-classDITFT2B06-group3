const pool = require('./db');
const parseId = require('../utils/parseId');

module.exports.getAllStalls = async function getAllStalls() {
  const { rows } = await pool.query(
    `SELECT "id", "name", "pickupLocation"
       FROM "Stall"
      WHERE "isActive" = true
      ORDER BY "name"`,
  );
  return rows;
};

module.exports.getStallById = async function getStallById(id) {
  const stallId = parseId(id);
  if (stallId === null) return null;

  const { rows } = await pool.query(
    `SELECT "id", "name", "pickupLocation"
       FROM "Stall"
      WHERE "id" = $1 AND "isActive" = true`,
    [stallId],
  );
  return rows[0] || null;
};
