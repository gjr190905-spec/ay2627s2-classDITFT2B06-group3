const pool = require('./db');

function safeId(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError('Unsupported account ID.');
  return number;
}

function publicAccount(row) {
  if (!row) return null;
  return {
    id: safeId(row.id),
    email: row.email,
    name: row.name,
    role: row.role,
    stallId: row.stallId == null ? null : safeId(row.stallId),
    stallName: row.stallName ?? null,
    ...(row.passwordHash === undefined ? {} : { passwordHash: row.passwordHash }),
    ...(row.isActive === undefined ? {} : { isActive: row.isActive === 1 }),
  };
}

/** Map to the existing prototype's users table, without exposing hashes in API responses. */
async function findAccountByEmail(email) {
  if (typeof email !== 'string' || email.trim().length === 0) return null;

  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.display_name AS name, u.role,
            u.password_hash AS "passwordHash", u.stall_id AS "stallId",
            u.is_active AS "isActive", s.name AS "stallName"
       FROM users u
       LEFT JOIN stalls s ON s.id = u.stall_id
      WHERE LOWER(u.email) = LOWER($1)
      LIMIT 1`,
    [email.trim()],
  );
  return publicAccount(rows[0]);
}

/** One transaction creates a customer with a hashed password in the existing users table. */
async function createCustomerAccount({ displayName, email, passwordHash }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, display_name, phone, role, stall_id, is_active, created_at)
       VALUES ($1, $2, $3, NULL, 'customer', NULL, 1, $4)
       RETURNING id, email, display_name AS name, role, stall_id AS "stallId"`,
      [email, passwordHash, displayName, new Date().toISOString()],
    );
    const account = publicAccount(rows[0]);
    await client.query('COMMIT');
    return account;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Preserve original error. */
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { findAccountByEmail, createCustomerAccount };
