const express = require('express');
const { authenticateAccount } = require('../services/login-service');
const { registerCustomerAccount } = require('../services/registration-service');
const { revokeSession } = require('../models/Session.model');
const { requireAuthentication } = require('../middleware/access-control');
const { signToken } = require('../middleware/auth');
const {
  startSession,
  clearSession,
  requireSameOrigin,
  requireCsrf,
} = require('../middleware/auth-session');

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function requireJson(req, res, next) {
  if (!req.is('application/json'))
    return res.status(415).json({ error: 'Send JSON with Content-Type: application/json.' });
  return next();
}

function toPublicUser(account) {
  if (!account) return null;
  return {
    id: account.id,
    email: account.email,
    displayName: account.name,
    phone: account.phone ?? '',
    role: account.role,
    stallId: account.stallId ?? null,
    stallName: account.stallName ?? null,
    active: true,
  };
}

// Cookie login remains functional without JWT configuration. The optional access
// token is issued only when JWT_SECRET is configured. Never send the signing secret.
function jwtAfterLogin(res, account) {
  if (!process.env.JWT_SECRET) return {};
  const sessionHash = res.locals?.newSessionTokenHash;
  if (!sessionHash) throw new Error('Could not bind JWT to a persistent session.');
  return { accessToken: signToken(account, sessionHash), tokenType: 'Bearer', expiresIn: 600 };
}

router.post('/signup', requireSameOrigin, requireJson, async (req, res, next) => {
  try {
    const result = await registerCustomerAccount(req.body);
    if (!result.created) {
      const status = result.errors.email?.includes('already exists') ? 409 : 400;
      return res.status(status).json({ errors: result.errors });
    }
    const csrfToken = await startSession(res, result.account);
    const access = jwtAfterLogin(res, result.account);
    return res.status(201).json({
      user: toPublicUser(result.account),
      csrfToken,
      ...access,
      message: 'Your account has been created.',
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', requireSameOrigin, requireJson, async (req, res, next) => {
  try {
    const result = await authenticateAccount(req.body);
    if (!result.authenticated) {
      const invalidInput = Object.keys(result.errors).some((field) => field !== 'form');
      return res.status(invalidInput ? 400 : 401).json({ errors: result.errors });
    }
    const csrfToken = await startSession(res, result.account);
    const access = jwtAfterLogin(res, result.account);
    return res.json({ user: toPublicUser(result.account), csrfToken, ...access });
  } catch (error) {
    return next(error);
  }
});

// Existing browser sessions can request a fresh short-lived Bearer JWT
// without asking for the password again. Same-origin + CSRF protect minting.
router.post('/token', requireSameOrigin, requireAuthentication, requireCsrf, (req, res, next) => {
  try {
    if (!req.sessionTokenHash) return res.status(401).json({ error: 'Session required.' });
    return res.json({
      accessToken: signToken(req.user, req.sessionTokenHash),
      tokenType: 'Bearer',
      expiresIn: 600,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', (req, res) =>
  res.json({ user: toPublicUser(req.user), csrfToken: req.csrfToken ?? null }),
);

router.post(
  '/logout',
  requireSameOrigin,
  requireJson,
  requireAuthentication,
  requireCsrf,
  async (req, res, next) => {
    try {
      await revokeSession(req.sessionTokenHash);
      clearSession(res);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
