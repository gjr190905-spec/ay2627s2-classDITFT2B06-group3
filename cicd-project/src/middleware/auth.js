/**
 * SCRUM integration JWT bridge: Bearer tokens are bound to a live server session.
 * JWT_SECRET must be a random 32+ character secret configured in the environment.
 * Checkout APIs accept an Authorization: Bearer <JWT> header.
 */
const jwt = require('jsonwebtoken');
const parseId = require('../utils/parseId');
const { findActiveSession } = require('../models/Session.model');
const { ERROR_CODES, mapError } = require('../utils/errors');

const VALID_ROLES = ['customer', 'vendor', 'admin', 'staff'];
const TOKEN_LIFETIME_SECONDS = 10 * 60;
const ISSUER = 'makan-liao';
const AUDIENCE = 'makan-liao-api';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }
  return secret;
}

function signToken({ id, role }, sessionTokenHash) {
  const userId = parseId(String(id));
  if (!userId || !VALID_ROLES.includes(role) || !/^[a-f0-9]{64}$/.test(sessionTokenHash || '')) {
    throw new Error('A valid user and active server session are required to issue a JWT');
  }
  return jwt.sign({ role, sid: sessionTokenHash, typ: 'access' }, getSecret(), {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: TOKEN_LIFETIME_SECONDS,
  });
}

function rejectUnauthenticated(next, message = 'Invalid or expired access token') {
  return next(mapError(ERROR_CODES.UNAUTHENTICATED, message));
}

async function authenticate(req, res, next) {
  // The bearer header is mandatory for JWT-only APIs. A cookie never bypasses it.
  req.user = null;
  req.authMethod = null;
  const header = req.headers.authorization;
  if (!header) return rejectUnauthenticated(next, 'Missing Authorization header');
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return rejectUnauthenticated(next, 'Authorization header must be: Bearer <token>');

  let claims;
  try {
    claims = jwt.verify(match[1], getSecret(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) return rejectUnauthenticated(next);
    return next(error);
  }

  const userId = parseId(claims.sub);
  if (
    !userId ||
    claims.typ !== 'access' ||
    !VALID_ROLES.includes(claims.role) ||
    !/^[a-f0-9]{64}$/.test(claims.sid || '')
  ) return rejectUnauthenticated(next);

  try {
    // A valid signature alone is insufficient: check active account and session
    // against PostgreSQL. Logout revokes JWTs by removing the linked session.
    const user = await findActiveSession(claims.sid);
    if (!user || user.id !== userId || user.role !== claims.role) {
      return rejectUnauthenticated(next);
    }
    const { id, name, email, role, stallId, stallName } = user;
    req.user = { id, name, email, role, stallId: stallId ?? null, stallName: stallName ?? null };
    req.authMethod = 'bearer';
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...allowedRoles) {
  allowedRoles.forEach((role) => {
    if (!VALID_ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  });
  return function checkRole(req, res, next) {
    if (!req.user) return next(mapError(ERROR_CODES.UNAUTHENTICATED));
    if (!allowedRoles.includes(req.user.role)) return next(mapError(ERROR_CODES.FORBIDDEN));
    return next();
  };
}

module.exports = { signToken, authenticate, requireRole };
