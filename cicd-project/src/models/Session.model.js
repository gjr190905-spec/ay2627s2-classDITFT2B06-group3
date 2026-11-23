const pool = require('./db');

/** Store a SHA-256 token digest and independent CSRF secret in prototype sessions. */
async function createSession(userId, tokenHash, expiresAt, csrfToken) {
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [tokenHash, userId, csrfToken, expiresAt.toISOString(), new Date().toISOString()],
  );
}

/** Active sessions only; inactive or deleted users cannot authenticate. */
async function findActiveSession(tokenHash) {
  const { rows } = await pool.query(
    `SELECT u.id, u.display_name AS name, u.email, u.role,
            u.stall_id AS "stallId", s.name AS "stallName", sess.csrf_token AS "csrfToken"
       FROM sessions sess
       JOIN users u ON u.id = sess.user_id
       LEFT JOIN stalls s ON s.id = u.stall_id
      WHERE sess.token_hash = $1 AND sess.expires_at > $2 AND u.is_active = 1
      LIMIT 1`,
    [tokenHash, new Date().toISOString()],
  );
  const user = rows[0];
  if (!user) return null;
  const id = Number(user.id);
  const stallId = user.stallId == null ? null : Number(user.stallId);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    (stallId != null && (!Number.isSafeInteger(stallId) || stallId <= 0))
  ) {
    throw new RangeError('Unsupported user ID.');
  }
  return { ...user, id, stallId };
}

async function revokeSession(tokenHash) {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

module.exports = { createSession, findActiveSession, revokeSession };
