const pool = require('../db');
const parseId = require('../../utils/parseId');

module.exports.getMenuItemsByStallId = async function getMenuItemsByStallId(stallId) {
  const id = parseId(stallId);
  if (id === null) return null;

  const { rows } = await pool.query(
    `SELECT m."id", m."name", m."priceCents", m."isAvailable"
       FROM "MenuItem" m
       JOIN "Stall" s ON m."stallId" = s."id"
      WHERE m."stallId" = $1 AND s."isActive" = true
      ORDER BY m."name"`,
    [id],
  );
  return rows;
};
