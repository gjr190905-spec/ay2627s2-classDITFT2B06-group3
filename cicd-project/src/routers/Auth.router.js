const express = require('express');
const { authenticateAccount } = require('../services/login-service');
const { registerCustomerAccount } = require('../services/registration-service');
const { revokeSession } = require('../models/Session.model');
const { requireAuthentication } = require('../middleware/access-control');
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

router.post('/signup', requireSameOrigin, requireJson, async (req, res, next) => {
  try {
    const result = await registerCustomerAccount(req.body);
    if (!result.created) {
      const status = result.errors.email?.includes('already exists') ? 409 : 400;
      return res.status(status).json({ errors: result.errors });
    }
    const csrfToken = await startSession(res, result.account);
    return res.status(201).json({
      user: toPublicUser(result.account),
      csrfToken,
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
    return res.json({ user: toPublicUser(result.account), csrfToken });
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
