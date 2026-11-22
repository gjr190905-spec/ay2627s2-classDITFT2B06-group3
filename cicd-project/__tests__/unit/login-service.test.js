jest.mock('../../src/models/Account.model', () => ({ findAccountByEmail: jest.fn() }));
jest.mock('../../src/services/password-security', () => ({ verifyPassword: jest.fn() }));

const { findAccountByEmail } = require('../../src/models/Account.model');
const { verifyPassword } = require('../../src/services/password-security');
const { authenticateAccount } = require('../../src/services/login-service');

const credentials = { email: ' USER@example.com ', password: ' example123 ' };
const account = {
  id: 4,
  name: 'Jo',
  email: 'user@example.com',
  role: 'customer',
  passwordHash: 'stored-hash',
};

beforeEach(() => jest.resetAllMocks());

test('rejects invalid input before accessing the database', async () => {
  const result = await authenticateAccount({});
  expect(result.authenticated).toBe(false);
  expect(result.errors.email).toBeDefined();
  expect(findAccountByEmail).not.toHaveBeenCalled();
});

test('returns the same failure for unknown email and wrong password', async () => {
  findAccountByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce(account);
  verifyPassword.mockResolvedValue(false);
  const unknown = await authenticateAccount(credentials);
  const wrong = await authenticateAccount(credentials);
  expect(unknown).toEqual({
    authenticated: false,
    account: null,
    errors: { form: 'Incorrect email or password.' },
  });
  expect(wrong).toEqual(unknown);
});

test('uses the stored role and excludes the password hash from the result', async () => {
  findAccountByEmail.mockResolvedValue(account);
  verifyPassword.mockResolvedValue(true);
  const result = await authenticateAccount({ ...credentials, role: 'vendor', id: 99 });
  expect(findAccountByEmail).toHaveBeenCalledWith('user@example.com');
  expect(verifyPassword).toHaveBeenCalledWith(' example123 ', 'stored-hash');
  expect(result).toEqual({
    authenticated: true,
    account: { id: 4, name: 'Jo', email: 'user@example.com', role: 'customer' },
    errors: {},
  });
});

test('propagates a database failure to the caller', async () => {
  findAccountByEmail.mockRejectedValue(new Error('Database unavailable'));
  await expect(authenticateAccount(credentials)).rejects.toThrow('Database unavailable');
});
