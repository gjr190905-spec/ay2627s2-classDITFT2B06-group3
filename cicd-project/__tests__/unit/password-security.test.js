const { hashPassword, verifyPassword } = require('../../src/services/password-security');

describe('SCRUM-12: Password security', () => {
  const password = 'SecurePassword123!';

  test('hashes a valid password without storing it as plain text', async () => {
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  test('generates different salted hashes for the same password', async () => {
    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);

    expect(firstHash).not.toBe(secondHash);
  });

  test('accepts the correct password', async () => {
    const hash = await hashPassword(password);

    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  test('rejects an incorrect password', async () => {
    const hash = await hashPassword(password);

    await expect(verifyPassword('WrongPassword123!', hash)).resolves.toBe(false);
  });

  test('rejects empty and short passwords', async () => {
    await expect(hashPassword('')).rejects.toThrow(RangeError);
    await expect(hashPassword('short')).rejects.toThrow(RangeError);
  });

  test('rejects passwords exceeding 72 UTF-8 bytes', async () => {
    await expect(hashPassword('a'.repeat(73))).rejects.toThrow(RangeError);
    await expect(hashPassword('😊'.repeat(19))).rejects.toThrow(RangeError);
  });

  test('rejects invalid password hashes', async () => {
    await expect(verifyPassword(password, 'invalid-hash')).resolves.toBe(false);
    await expect(verifyPassword(password, null)).resolves.toBe(false);
  });
});
