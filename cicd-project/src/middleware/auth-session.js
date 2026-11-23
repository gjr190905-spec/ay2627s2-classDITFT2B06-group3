const crypto = require('node:crypto');
const { createSession, findActiveSession } = require('../models/Session.model');

const COOKIE_NAME = 'ml_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
// Match the roles accepted by Person.role and access-control middleware.
const VALID_ROLES = new Set(['customer', 'staff', 'vendor', 'admin']);

function readSessionToken(req) {
  const cookie = req.headers?.cookie;
  if (typeof cookie !== 'string' || cookie.length > 8192) return null;
  const pair = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!pair) return null;
  const value = pair.slice(COOKIE_NAME.length + 1);
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function sessionCookie(token, maxAge = SESSION_SECONDS) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true')
    parts.push('Secure');
  return parts.join('; ');
}

async function loadSession(req, res, next) {
  req.user = null;
  req.sessionTokenHash = null;
  req.csrfToken = null;
  const token = readSessionToken(req);
  if (!token) return next();

  try {
    const tokenHash = hashToken(token);
    const sessionUser = await findActiveSession(tokenHash);
    if (
      sessionUser &&
      Number.isSafeInteger(sessionUser.id) &&
      sessionUser.id > 0 &&
      VALID_ROLES.has(sessionUser.role)
    ) {
      const { id, name, email, role, stallId, stallName, csrfToken } = sessionUser;
      req.user = { id, name, email, role, stallId: stallId ?? null, stallName: stallName ?? null };
      req.sessionTokenHash = tokenHash;
      req.csrfToken = csrfToken;
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

async function startSession(res, account) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + SESSION_SECONDS * 1000);
  await createSession(account.id, hashToken(token), expiry, csrfToken);
  // Keep the session digest server-side so short-lived JWTs can be revoked on logout.
  if (res.locals) res.locals.newSessionTokenHash = hashToken(token);
  res.set('Set-Cookie', sessionCookie(token));
  return csrfToken;
}

function clearSession(res) {
  res.set('Set-Cookie', sessionCookie('', 0));
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('Origin');
  if (!origin) return next();
  const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
  if (origin !== expected) return res.status(403).json({ error: 'Invalid request origin.' });
  return next();
}

function requireCsrf(req, res, next) {
  const supplied = req.get('X-CSRF-Token');
  const expected = req.csrfToken;
  if (typeof supplied !== 'string' || typeof expected !== 'string') {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }
  return next();
}

module.exports = {
  loadSession,
  startSession,
  clearSession,
  requireSameOrigin,
  requireCsrf,
  readSessionToken,
  hashToken,
};
