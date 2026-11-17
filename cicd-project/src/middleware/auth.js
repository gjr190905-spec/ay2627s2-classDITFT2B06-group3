const jwt = require('jsonwebtoken');
const parseId = require('../utils/parseId');
const { ERROR_CODES, mapError } = require('../utils/errors');

const VALID_ROLES = ['customer', 'vendor', 'admin'];
const TOKEN_LIFETIME = '8h';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }
  return secret;
}

function signToken({ id, role }) {
  return jwt.sign({ role }, getSecret(), {
    algorithm: 'HS256',
    subject: String(id),
    expiresIn: TOKEN_LIFETIME,
  });
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return next(mapError(ERROR_CODES.UNAUTHENTICATED, 'Missing Authorization header'));
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return next(
      mapError(ERROR_CODES.UNAUTHENTICATED, 'Authorization header must be: Bearer <token>'),
    );
  }

  let payload;
  try {
    payload = jwt.verify(match[1], getSecret(), { algorithms: ['HS256'] });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return next(mapError(ERROR_CODES.UNAUTHENTICATED, 'Invalid or expired token'));
    }
    return next(err);
  }

  const userId = parseId(payload.sub);
  if (userId === null || !VALID_ROLES.includes(payload.role)) {
    return next(mapError(ERROR_CODES.UNAUTHENTICATED, 'Invalid or expired token'));
  }

  req.user = { id: userId, role: payload.role };
  return next();
}

function requireRole(...allowedRoles) {
  allowedRoles.forEach((role) => {
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Unknown role: ${role}`);
    }
  });

  return function checkRole(req, res, next) {
    if (!req.user) {
      return next(mapError(ERROR_CODES.UNAUTHENTICATED));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(mapError(ERROR_CODES.FORBIDDEN));
    }
    return next();
  };
}

module.exports = { signToken, authenticate, requireRole };