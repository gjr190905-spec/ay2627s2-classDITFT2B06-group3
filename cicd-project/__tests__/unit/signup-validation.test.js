const { validateSignupInput } = require('../../src/services/signup-validation');

const validSignup = {
  displayName: 'Alex Tan',
  email: 'alex@sp.edu.sg',
  password: 'secure passphrase 2026',
  confirmPassword: 'secure passphrase 2026',
};

describe('SCRUM-12 customer sign-up input validation', () => {
  test('accepts valid customer details', () => {
    expect(validateSignupInput(validSignup)).toEqual({
      valid: true,
      errors: {},
      data: {
        displayName: validSignup.displayName,
        email: validSignup.email,
        password: validSignup.password,
      },
    });
  });

  test('normalises name whitespace and email case', () => {
    const result = validateSignupInput({
      ...validSignup,
      displayName: '  Alex   Tan  ',
      email: ' ALEX@SP.EDU.SG ',
    });
    expect(result.data.displayName).toBe('Alex Tan');
    expect(result.data.email).toBe('alex@sp.edu.sg');
  });

  test('allows names with apostrophes, hyphens, and Unicode', () => {
    const result = validateSignupInput({ ...validSignup, displayName: "Anne-Marie O'Neil 李" });
    expect(result.valid).toBe(true);
  });

  test('does not restrict registration to school email addresses', () => {
    expect(validateSignupInput({ ...validSignup, email: 'guest@gmail.com' }).valid).toBe(true);
  });

  test('accepts plus-addressed emails', () => {
    expect(validateSignupInput({ ...validSignup, email: 'alex+campus@sp.edu.sg' }).valid).toBe(
      true,
    );
  });

  test.each([null, undefined, '', 0, 42, [], 'displayName=Alex'])(
    'rejects invalid body %p',
    (body) => {
      const result = validateSignupInput(body);
      expect(result.valid).toBe(false);
      expect(result.errors.form).toBeDefined();
      expect(result.data).toBeNull();
    },
  );

  test('rejects missing name', () => {
    const body = { ...validSignup };
    delete body.displayName;
    expect(validateSignupInput(body).errors.displayName).toBe('Name is required.');
  });

  test('rejects whitespace-only name', () => {
    expect(validateSignupInput({ ...validSignup, displayName: '   ' }).valid).toBe(false);
  });

  test('rejects single-character name', () => {
    expect(
      validateSignupInput({ ...validSignup, displayName: 'A' }).errors.displayName,
    ).toBeDefined();
  });

  test('accepts 80-character name', () => {
    expect(validateSignupInput({ ...validSignup, displayName: 'A'.repeat(80) }).valid).toBe(true);
  });

  test('rejects name longer than 80 characters', () => {
    expect(validateSignupInput({ ...validSignup, displayName: 'A'.repeat(81) }).valid).toBe(false);
  });

  test('rejects markup-like name input', () => {
    expect(validateSignupInput({ ...validSignup, displayName: '<script>' }).valid).toBe(false);
  });

  test('rejects control characters in display names', () => {
    const displayName = `Alex${String.fromCharCode(0)}Tan`;
    expect(validateSignupInput({ ...validSignup, displayName }).errors.displayName).toBe(
      'Name contains unsupported characters.',
    );
  });

  test('rejects non-string name', () => {
    expect(validateSignupInput({ ...validSignup, displayName: 123 }).valid).toBe(false);
  });

  test('rejects missing email', () => {
    const body = { ...validSignup };
    delete body.email;
    expect(validateSignupInput(body).errors.email).toBe('Email is required.');
  });

  test.each(['x', '@sp.edu.sg', 'alex@', 'alex@sp', 'a b@sp.edu.sg', 'alex@@sp.edu.sg'])(
    'rejects malformed email %p',
    (email) => {
      expect(validateSignupInput({ ...validSignup, email }).errors.email).toBeDefined();
    },
  );

  test('rejects email longer than 254 characters', () => {
    expect(
      validateSignupInput({ ...validSignup, email: `${'a'.repeat(250)}@sp.edu.sg` }).valid,
    ).toBe(false);
  });

  test('rejects missing password', () => {
    const body = { ...validSignup };
    delete body.password;
    expect(validateSignupInput(body).errors.password).toBe('Password is required.');
  });

  test('rejects whitespace-only password', () => {
    expect(validateSignupInput({ ...validSignup, password: '        ' }).valid).toBe(false);
  });

  test('rejects a password shorter than eight characters', () => {
    expect(
      validateSignupInput({ ...validSignup, password: 'seven77', confirmPassword: 'seven77' })
        .errors.password,
    ).toBeDefined();
  });

  test('accepts exactly eight password characters', () => {
    expect(
      validateSignupInput({ ...validSignup, password: 'abcdefgh', confirmPassword: 'abcdefgh' })
        .valid,
    ).toBe(true);
  });

  test('rejects a password longer than 128 characters', () => {
    const password = 'a'.repeat(129);
    expect(validateSignupInput({ ...validSignup, password, confirmPassword: password }).valid).toBe(
      false,
    );
  });

  test('preserves intentional whitespace in passwords', () => {
    const password = ' spaced password ';
    expect(
      validateSignupInput({ ...validSignup, password, confirmPassword: password }).data.password,
    ).toBe(password);
  });

  test('requires password confirmation', () => {
    const body = { ...validSignup };
    delete body.confirmPassword;
    expect(validateSignupInput(body).errors.confirmPassword).toBe('Please confirm your password.');
  });

  test('rejects mismatched password confirmation', () => {
    expect(
      validateSignupInput({ ...validSignup, confirmPassword: 'another-password' }).errors
        .confirmPassword,
    ).toBe('Passwords do not match.');
  });

  test('treats password confirmation as case sensitive', () => {
    expect(
      validateSignupInput({ ...validSignup, confirmPassword: 'Secure passphrase 2026' }).valid,
    ).toBe(false);
  });

  test('never passes confirmation, role, user ID or stall ID to registration', () => {
    const result = validateSignupInput({
      ...validSignup,
      role: 'vendor',
      userId: 77,
      stallId: 12,
      isAdmin: true,
      status: 'active',
    });
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({
      displayName: validSignup.displayName,
      email: validSignup.email,
      password: validSignup.password,
    });
    expect(result.data.role).toBeUndefined();
    expect(result.data.confirmPassword).toBeUndefined();
  });

  test('returns several errors together without echoing passwords', () => {
    const result = validateSignupInput({
      displayName: '',
      email: 'invalid',
      password: 'bad',
      confirmPassword: 'secret-value',
    });
    expect(Object.keys(result.errors)).toEqual([
      'displayName',
      'email',
      'password',
      'confirmPassword',
    ]);
    expect(result.data).toBeNull();
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  test('does not mutate the original input', () => {
    const input = { ...validSignup, displayName: '  Alex   Tan  ' };
    validateSignupInput(input);
    expect(input.displayName).toBe('  Alex   Tan  ');
  });

  test('accepts a password of exactly 72 UTF-8 bytes', () => {
    const password = 'a'.repeat(72);
    const result = validateSignupInput({
      ...validSignup,
      password,
      confirmPassword: password,
    });

    expect(result.valid).toBe(true);
  });

  test('rejects passwords exceeding 72 UTF-8 bytes', () => {
    const password = 'a'.repeat(73);
    const result = validateSignupInput({
      ...validSignup,
      password,
      confirmPassword: password,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.password).toBe('Password must not exceed 72 UTF-8 bytes.');
  });

  test('rejects Unicode passwords exceeding 72 UTF-8 bytes', () => {
    const password = '😊'.repeat(19);
    const result = validateSignupInput({
      ...validSignup,
      password,
      confirmPassword: password,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.password).toBe('Password must not exceed 72 UTF-8 bytes.');
  });
});
