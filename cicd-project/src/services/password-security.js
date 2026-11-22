const crypto = require('node:crypto');
const { promisify } = require('node:util');
const bcrypt = require('bcryptjs');

const scrypt = promisify(crypto.scrypt);
const MAX_PASSWORD_BYTES = 1024;
const SCRYPT_PATTERN = /^scrypt\$v1\$[0-9a-f]{32}\$[0-9a-f]{128}$/;

/** New registrations use the same scrypt$v1 format as the approved prototype. */
async function hashPassword(password) {
  if (
    typeof password !== 'string' ||
    password.trim().length === 0 ||
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new RangeError('Password must be at least 8 characters and at most 72 UTF-8 bytes.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt$v1$${salt}$${key.toString('hex')}`;
}

/** Read existing prototype scrypt hashes; retain bcrypt verification for past/other accounts. */
async function verifyPassword(password, storedHash) {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES ||
    typeof storedHash !== 'string'
  )
    return false;

  try {
    if (SCRYPT_PATTERN.test(storedHash)) {
      const [, , salt, hex] = storedHash.split('$');
      const expected = Buffer.from(hex, 'hex');
      const actual = await scrypt(password, salt, expected.length);
      return crypto.timingSafeEqual(expected, actual);
    }
    if (/^\$2[aby]\$\d{2}\$/.test(storedHash) && Buffer.byteLength(password, 'utf8') <= 72) {
      return await bcrypt.compare(password, storedHash);
    }
  } catch {
    return false;
  }
  return false;
}

module.exports = { hashPassword, verifyPassword };
