const pool = require('./db');

/**
 * Internal lookup for authentication.
 * Never return passwordHash directly in an API response.
 */
async function findAccountByEmail(email) {
  if (typeof email !== 'string' || email.trim().length === 0) {
    return null;
  }

  const { rows } = await pool.query(
    `SELECT
       p."id",
       p."email",
       p."name",
       p."role",
       c."passwordHash"
     FROM "Person" AS p
     INNER JOIN "PersonCredential" AS c
       ON c."personId" = p."id"
     WHERE LOWER(p."email") = LOWER($1)
     LIMIT 1`,
    [email.trim()],
  );

  return rows[0] ?? null;
}

/**
 * Persist an already validated customer and bcrypt password hash.
 * The registration service must hash the password before calling this.
 * The role is assigned by trusted server code.
 */
async function createCustomerAccount({ displayName, email, passwordHash }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO "Person" ("email", "name", "role")
       VALUES ($1, $2, 'customer')
       RETURNING "id", "email", "name", "avatar", "role"`,
      [email, displayName],
    );

    const person = rows[0];

    await client.query(
      `INSERT INTO "PersonCredential" ("personId", "passwordHash")
       VALUES ($1, $2)`,
      [person.id, passwordHash],
    );

    await client.query('COMMIT');

    // Password hashes must not be part of the signup response.
    return person;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original database error.
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  findAccountByEmail,
  createCustomerAccount,
};
