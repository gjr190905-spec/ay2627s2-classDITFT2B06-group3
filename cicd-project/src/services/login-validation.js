/**
 * Makan Liao — server-side login input validation (SCRUM-12).
 *
 * This validates request format only. It DOES NOT authenticate users.
 * Credentials must be checked against password hashes by a separate service.
 * Never log or return raw passwords in API responses.
 * Never trust a role or user ID supplied by a login request.
 */
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateLoginInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errors: { form: 'Please provide your sign-in details.' },
      data: null,
    };
  }

  const errors = {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (email.length === 0) {
    errors.email = 'Email is required.';
  } else if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (password.trim().length === 0) {
    errors.password = 'Password is required.';
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    errors.password = 'Password is too long.';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, data: null };
  }

  // Only allow credential fields into the authentication service. The caller
  // must derive the user's role and assigned stall from trusted server data.
  // Do not trim passwords: leading/trailing spaces can be significant.
  return { valid: true, errors: {}, data: { email, password } };
}

module.exports = { validateLoginInput };
