const pool = require('./db');

function safeId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('Invalid account ID.');
  return id;
}

function publicProfile(row) {
  if (!row) return null;
  return {
    id: safeId(row.id),
    email: row.email,
    displayName: row.displayName,
    phone: row.phone ?? '',
    role: row.role,
    stallId: row.stallId == null ? null : safeId(row.stallId),
    stallName: row.stallName ?? null,
    active: true,
  };
}

// Always use the authenticated session ID; never accept a client-selected account ID.
async function findProfileById(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.display_name AS "displayName", u.phone,
            u.role, u.stall_id AS "stallId", s.name AS "stallName"
       FROM users u
       LEFT JOIN stalls s ON s.id = u.stall_id
      WHERE u.id = $1 AND u.is_active = 1
      LIMIT 1`,
    [safeId(userId)],
  );
  return publicProfile(rows[0]);
}

async function updateProfileById(userId, displayName, phone) {
  const id = safeId(userId);
  const result = await pool.query(
    `UPDATE users
        SET display_name = $2, phone = $3
      WHERE id = $1 AND is_active = 1
      RETURNING id`,
    [id, displayName, phone],
  );
  if (result.rows.length === 0) return null;
  return findProfileById(id);
}

module.exports = { findProfileById, updateProfileById };
