jest.mock('../../src/models/Account.model', () => ({
  findAccountByEmail: jest.fn(),
  createCustomerAccount: jest.fn(),
}));
jest.mock('../../src/services/password-security', () => ({ hashPassword: jest.fn() }));

const { findAccountByEmail, createCustomerAccount } = require('../../src/models/Account.model');
const { hashPassword } = require('../../src/services/password-security');
const { registerCustomerAccount } = require('../../src/services/registration-service');

const validDetails = {
  displayName: 'Alex Tan',
  email: 'alex@example.com',
  password: 'correct horse battery',
  confirmPassword: 'correct horse battery',
};

describe('SCRUM-12 customer registration service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects invalid details before database access or hashing', async () => {
    const result = await registerCustomerAccount({ ...validDetails, confirmPassword: 'different' });

    expect(result).toEqual({
      created: false,
      account: null,
      errors: { confirmPassword: 'Passwords do not match.' },
    });
    expect(findAccountByEmail).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  test('rejects an email already in use', async () => {
    findAccountByEmail.mockResolvedValue({ id: 3 });

    const result = await registerCustomerAccount(validDetails);

    expect(result.created).toBe(false);
    expect(result.errors.email).toBe('An account with this email already exists.');
    expect(hashPassword).not.toHaveBeenCalled();
    expect(createCustomerAccount).not.toHaveBeenCalled();
  });

  test('hashes the password and creates a customer account', async () => {
    const account = { id: 5, email: 'alex@example.com', role: 'customer' };
    findAccountByEmail.mockResolvedValue(null);
    hashPassword.mockResolvedValue('bcrypt-hash');
    createCustomerAccount.mockResolvedValue(account);

    const result = await registerCustomerAccount(validDetails);

    expect(hashPassword).toHaveBeenCalledWith(validDetails.password);
    expect(createCustomerAccount).toHaveBeenCalledWith({
      displayName: 'Alex Tan',
      email: 'alex@example.com',
      passwordHash: 'bcrypt-hash',
    });
    expect(result).toEqual({ created: true, account, errors: {} });
  });

  test('handles a duplicate email detected by the database constraint', async () => {
    findAccountByEmail.mockResolvedValue(null);
    hashPassword.mockResolvedValue('bcrypt-hash');
    createCustomerAccount.mockRejectedValue({ code: '23505' });

    const result = await registerCustomerAccount(validDetails);

    expect(result.created).toBe(false);
    expect(result.account).toBeNull();
    expect(result.errors.email).toBe('An account with this email already exists.');
  });
});
