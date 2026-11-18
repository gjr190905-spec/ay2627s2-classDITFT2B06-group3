/**
 * Makan Liao — customer sign-up input validation (SCRUM-12, Day 3).
 *
 * This checks request data only. It DOES NOT create accounts, query the
 * database, hash passwords, or create sessions. Those are follow-up tasks.
 * Account role and IDs must be assigned by trusted server code, never by the
 * sign-up request. Vendor accounts are provisioned by authorised staff.
 */
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSignupInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errors: { form: 'Please provide your sign-up details.' },
      data: null,
    };
  }

  const errors = {};
  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  // Preserve password exactly; spaces may be intentionally included.
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

  if (displayName.length === 0) {
    errors.displayName = 'Name is required.';
  } else if (displayName.length < 2 || displayName.length > MAX_NAME_LENGTH) {
    errors.displayName = 'Name must be between 2 and 80 characters.';
  } else if (
    /[<>]/u.test(displayName) ||
    Array.from(displayName).some((char) => {
      const codePoint = char.codePointAt(0);
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    errors.displayName = 'Name contains unsupported characters.';
  }

  if (email.length === 0) {
    errors.email = 'Email is required.';
  } else if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (password.trim().length === 0) {
    errors.password = 'Password is required.';
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = 'Password must have at least 8 characters.';
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    errors.password = 'Password must not exceed 128 characters.';
  }

  if (confirmPassword.length === 0) {
    errors.confirmPassword = 'Please confirm your password.';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (Object.keys(errors).length > 0) {
    // A failed response must never return or echo password values.
    return { valid: false, errors, data: null };
  }

  // Whitelist ONLY fields needed by a future registration service.
  // Never trust role, userId, stallId, account status, or similar inputs.
  // A registration route must set role='customer' on the server.
  return { valid: true, errors: {}, data: { displayName, email, password } };
}

module.exports = { validateSignupInput };
