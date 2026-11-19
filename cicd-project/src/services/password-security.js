const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;
const MAX_PASSWORD_BYTES = 72;

/**
 * Hash a valid password before storing it in the database.
 */
async function hashPassword(password) {
  if (
    typeof password !== 'string' ||
    password.trim().length === 0 ||
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    throw new RangeError('Password must be at least 8 characters and at most 72 UTF-8 bytes.');
  }

  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a supplied password against a stored bcrypt hash.
 */
async function verifyPassword(password, storedHash) {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES ||
    typeof storedHash !== 'string' ||
    storedHash.length === 0
  ) {
    return false;
  }

  try {
    return await bcrypt.compare(password, storedHash);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
