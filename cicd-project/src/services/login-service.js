const { findAccountByEmail } = require('../models/Account.model');
const { validateLoginInput } = require('./login-validation');
const { verifyPassword } = require('./password-security');

async function authenticateAccount(body) {
  const input = validateLoginInput(body);
  if (!input.valid) return { authenticated: false, account: null, errors: input.errors };

  const { email, password } = input.data;
  const account = await findAccountByEmail(email);
  if (
    !account ||
    account.isActive !== true ||
    !(await verifyPassword(password, account.passwordHash))
  ) {
    return {
      authenticated: false,
      account: null,
      errors: { form: 'Incorrect email or password.' },
    };
  }

  const { id, name, role, stallId, stallName } = account;
  return {
    authenticated: true,
    account: {
      id,
      name,
      email: account.email,
      role,
      stallId: stallId ?? null,
      stallName: stallName ?? null,
    },
    errors: {},
  };
}

module.exports = { authenticateAccount };
