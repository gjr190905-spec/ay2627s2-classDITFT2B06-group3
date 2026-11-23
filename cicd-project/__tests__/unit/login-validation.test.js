const { validateLoginInput } = require('../../src/services/login-validation');

const validCredentials = { email: 'student@sp.edu.sg', password: 'LongPass!42' };

describe('SCRUM-12 login input validation', () => {
  test('accepts a valid student email and password', () => {
    expect(validateLoginInput(validCredentials)).toEqual({
      valid: true,
      errors: {},
      data: validCredentials,
    });
  });

  test('accepts a staff email: accounts are not restricted by user role', () => {
    expect(validateLoginInput({ email: 'staff@sp.edu.sg', password: 'ValidPass123!' }).valid).toBe(
      true,
    );
  });

  test('normalizes email whitespace and case only', () => {
    expect(
      validateLoginInput({ email: '  Student@SP.edu.sg  ', password: 'LongPass!42' }).data,
    ).toEqual(validCredentials);
  });

  test('preserves significant whitespace in passwords', () => {
    const result = validateLoginInput({ email: 'student@sp.edu.sg', password: ' pass  ' });
    expect(result.data.password).toBe(' pass  ');
  });

  test('accepts plus-addressed emails', () => {
    expect(
      validateLoginInput({ email: 'student+test@sp.edu.sg', password: 'LongPass!42' }).valid,
    ).toBe(true);
  });

  test.each([null, undefined, '', 0, 42, [], 'email=a'])(
    'rejects invalid request body %p',
    (body) => {
      const result = validateLoginInput(body);
      expect(result.valid).toBe(false);
      expect(result.errors.form).toBeDefined();
      expect(result.data).toBeNull();
    },
  );

  test('rejects missing email', () => {
    const result = validateLoginInput({ password: 'LongPass!42' });
    expect(result.errors.email).toBe('Email is required.');
  });

  test('rejects blank email', () => {
    expect(validateLoginInput({ email: '   ', password: 'LongPass!42' }).valid).toBe(false);
  });

  test('rejects non-string email', () => {
    expect(validateLoginInput({ email: 123, password: 'LongPass!42' }).errors.email).toBeDefined();
  });

  test.each([
    'student',
    'student@',
    '@sp.edu.sg',
    'student@sp',
    'stu dent@sp.edu.sg',
    'a@@sp.edu.sg',
  ])('rejects malformed email %p', (email) => {
    expect(validateLoginInput({ email, password: 'LongPass!42' }).errors.email).toBe(
      'Enter a valid email address.',
    );
  });

  test('rejects emails longer than 254 characters', () => {
    const email = `${'a'.repeat(250)}@sp.edu.sg`;
    expect(validateLoginInput({ email, password: 'LongPass!42' }).valid).toBe(false);
  });

  test('rejects missing password', () => {
    expect(validateLoginInput({ email: 'student@sp.edu.sg' }).errors.password).toBe(
      'Password is required.',
    );
  });

  test('rejects non-string passwords', () => {
    expect(validateLoginInput({ email: 'student@sp.edu.sg', password: 123 }).valid).toBe(false);
  });

  test('rejects whitespace-only passwords', () => {
    expect(validateLoginInput({ email: 'student@sp.edu.sg', password: '   ' }).valid).toBe(false);
  });

  test('rejects passwords longer than 256 characters', () => {
    const result = validateLoginInput({ email: 'student@sp.edu.sg', password: 'a'.repeat(257) });
    expect(result.errors.password).toBe('Password is too long.');
  });

  test('returns both field errors when both values are invalid', () => {
    const result = validateLoginInput({ email: '', password: '' });
    expect(result.errors).toEqual({
      email: 'Email is required.',
      password: 'Password is required.',
    });
  });

  test('does not accept client-asserted roles or user IDs as authentication data', () => {
    const result = validateLoginInput({
      ...validCredentials,
      role: 'vendor',
      userId: 999,
      stallId: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(validCredentials);
    expect(result.data.role).toBeUndefined();
  });

  test('does not include a password in validation error data', () => {
    const result = validateLoginInput({ email: 'bad', password: 'VerySecret!' });
    expect(result.data).toBeNull();
    expect(JSON.stringify(result.errors)).not.toContain('VerySecret!');
  });
});
