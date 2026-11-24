const pool = require('./db');
const parseId = require('../utils/parseId');

module.exports.getAllPersons = async function getAllPersons() {
  const { rows } = await pool.query('SELECT * FROM "Person"');
  return rows;
};
