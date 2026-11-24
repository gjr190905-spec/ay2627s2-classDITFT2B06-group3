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
    avatarUrl: row.avatarUpdatedAt ? `/api/profile/avatar?v=${new Date(row.avatarUpdatedAt).getTime()}` : null,
  };
}

// Always use the authenticated session ID; never accept a client-selected account ID.
async function findProfileById(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.display_name AS "displayName", u.phone,
            u.role, u.stall_id AS "stallId", s.name AS "stallName",
            p.updated_at AS "avatarUpdatedAt"
       FROM users u
       LEFT JOIN stalls s ON s.id = u.stall_id
       LEFT JOIN user_profile_images p ON p.user_id = u.id
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

// Images are stored in the database and scoped to the authenticated account ID.
async function findAvatarById(userId) {
  const { rows } = await pool.query(
    `SELECT p.image_data AS "imageData", p.content_type AS "contentType"
       FROM user_profile_images p
       JOIN users u ON u.id = p.user_id
      WHERE u.id = $1 AND u.is_active = 1
      LIMIT 1`,
    [safeId(userId)],
  );
  return rows[0] || null;
}

async function saveAvatarById(userId, contentType, imageData) {
  const { rows } = await pool.query(
    `INSERT INTO user_profile_images (user_id, content_type, image_data, updated_at)
     SELECT u.id, $2, $3, NOW() FROM users u WHERE u.id = $1 AND u.is_active = 1
     ON CONFLICT (user_id) DO UPDATE
        SET content_type = EXCLUDED.content_type,
            image_data = EXCLUDED.image_data,
            updated_at = NOW()
     RETURNING user_id`,
    [safeId(userId), contentType, imageData],
  );
  return rows.length ? findProfileById(userId) : null;
}

async function removeAvatarById(userId) {
  const id = safeId(userId);
  await pool.query('DELETE FROM user_profile_images WHERE user_id = $1', [id]);
  return findProfileById(id);
}

module.exports = { findProfileById, updateProfileById, findAvatarById, saveAvatarById, removeAvatarById };
