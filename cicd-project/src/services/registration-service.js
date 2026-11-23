const { findAccountByEmail, createCustomerAccount } = require('../models/Account.model');
const { hashPassword } = require('./password-security');
const { validateSignupInput } = require('./signup-validation');

/** Register a customer using validated input and a server-generated password hash. */
async function registerCustomerAccount(body) {
  const validation = validateSignupInput(body);

  if (!validation.valid) {
    return { created: false, account: null, errors: validation.errors };
  }

  const { displayName, email, password } = validation.data;
  const existingAccount = await findAccountByEmail(email);

  if (existingAccount) {
    return {
      created: false,
      account: null,
      errors: { email: 'An account with this email already exists.' },
    };
  }

  const passwordHash = await hashPassword(password);

  try {
    const account = await createCustomerAccount({ displayName, email, passwordHash });
    return { created: true, account, errors: {} };
  } catch (error) {
    // The unique email constraint also handles registrations racing after lookup.
    if (error.code === '23505') {
      return {
        created: false,
        account: null,
        errors: { email: 'An account with this email already exists.' },
      };
    }

    throw error;
  }
}

module.exports = { registerCustomerAccount };
