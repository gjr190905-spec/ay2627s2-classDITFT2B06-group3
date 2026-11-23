const bcrypt = require('bcryptjs');
const { hashPassword, verifyPassword } = require('../../src/services/password-security');

describe('SCRUM-12: Prototype-compatible password security', () => {
  const password = 'SecurePassword123!';
  test('hashes new passwords into the prototype scrypt$v1 format', async () => {
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(hash).toMatch(/^scrypt\$v1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword('WrongPassword123!', hash)).resolves.toBe(false);
  });
  test('generates independent salts', async () => {
    expect(await hashPassword(password)).not.toBe(await hashPassword(password));
  });
  test('accepts legacy bcrypt hashes without downgrading new scrypt writes', async () => {
    const oldHash = await bcrypt.hash(password, 10);
    await expect(verifyPassword(password, oldHash)).resolves.toBe(true);
    await expect(verifyPassword('incorrect', oldHash)).resolves.toBe(false);
  });
  test('rejects invalid password input', async () => {
    await expect(hashPassword('')).rejects.toThrow(RangeError);
    await expect(hashPassword('short')).rejects.toThrow(RangeError);
    await expect(hashPassword('a'.repeat(73))).rejects.toThrow(RangeError);
    await expect(hashPassword('😊'.repeat(19))).rejects.toThrow(RangeError);
  });
  test('rejects malformed hash formats and oversized login inputs', async () => {
    await expect(verifyPassword(password, 'invalid-hash')).resolves.toBe(false);
    await expect(verifyPassword(password, null)).resolves.toBe(false);
    await expect(verifyPassword('a'.repeat(1025), 'scrypt$v1$bad')).resolves.toBe(false);
  });
});
