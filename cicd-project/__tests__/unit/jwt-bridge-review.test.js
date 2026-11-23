// Secure bridge between SCRUM-12 server sessions and JWT-header checkout routes.
jest.mock('../../src/services/login-service', () => ({ authenticateAccount: jest.fn() }));
jest.mock('../../src/models/Session.model', () => ({
  createSession: jest.fn(),
  findActiveSession: jest.fn(),
  revokeSession: jest.fn(),
}));
const request = require('supertest');
const app = require('../../src/app');
const { signToken, authenticate, requireRole } = require('../../src/middleware/auth');
const { findActiveSession, createSession } = require('../../src/models/Session.model');
const { authenticateAccount } = require('../../src/services/login-service');
const csrf = 'b'.repeat(64);
const cookieToken = 'a'.repeat(64);
const hashToken = require('../../src/middleware/auth-session').hashToken;
const sessionHash = hashToken(cookieToken);
const customer = {
  id: 12,
  name: 'Customer',
  email: 'test@example.com',
  role: 'customer',
  stallId: null,
  csrfToken: csrf,
};
const oldSecret = process.env.JWT_SECRET;

beforeAll(() => { process.env.JWT_SECRET = 'secure-random-test-only-not-for-production-0123456789'; });
afterAll(() => {
  if (oldSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = oldSecret;
});
beforeEach(() => {
  jest.clearAllMocks();
  findActiveSession.mockResolvedValue(customer);
  createSession.mockResolvedValue();
});

test('minting JWT requires authenticated cookie and matching CSRF', async () => {
  const missingSession = await request(app).post('/api/auth/token').set('X-CSRF-Token', csrf);
  expect(missingSession.status).toBe(401);
  const missingCsrf = await request(app).post('/api/auth/token').set('Cookie', `ml_session=${cookieToken}`);
  expect(missingCsrf.status).toBe(403);
  const badOrigin = await request(app).post('/api/auth/token')
    .set('Cookie', `ml_session=${cookieToken}`).set('X-CSRF-Token', csrf)
    .set('Origin', 'https://attacker.invalid');
  expect(badOrigin.status).toBe(403);
});

test('valid cookie session mints an expiring signed JWT for Authorization header', async () => {
  const res = await request(app).post('/api/auth/token')
    .set('Cookie', `ml_session=${cookieToken}`).set('X-CSRF-Token', csrf);
  expect(res.status).toBe(200);
  expect(res.body.tokenType).toBe('Bearer');
  expect(res.body.expiresIn).toBe(600);
  expect(res.body.accessToken.split('.')).toHaveLength(3);
  expect(res.body).not.toHaveProperty('JWT_SECRET');
  const verify = require('jsonwebtoken').verify;
  const claims = verify(res.body.accessToken, process.env.JWT_SECRET, {
    algorithms: ['HS256'], issuer: 'makan-liao', audience: 'makan-liao-api',
  });
  expect(claims.sub).toBe('12');
  expect(claims.sid).toBe(sessionHash);
  expect(claims.exp - claims.iat).toBe(600);
});

test('login response can include short-lived JWT tied to the newly created session', async () => {
  authenticateAccount.mockResolvedValue({ authenticated: true, account: customer, errors: {} });
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'test@example.com', password: 'irrelevant-under-mock' });
  expect(res.status).toBe(200);
  expect(res.body.user.email).toBe(customer.email);
  expect(res.body.accessToken).toEqual(expect.any(String));
  const tokenClaims = require('jsonwebtoken').verify(res.body.accessToken, process.env.JWT_SECRET, {
    algorithms: ['HS256'], issuer: 'makan-liao', audience: 'makan-liao-api',
  });
  expect(tokenClaims.sid).toBe(createSession.mock.calls[0][1]);
});

function callAuth(token, mockedUser = customer) {
  findActiveSession.mockResolvedValue(mockedUser);
  const req = { headers: { authorization: token == null ? undefined : `Bearer ${token}` }, user: {id:999,role:'admin'} };
  const next = jest.fn();
  return authenticate(req, {}, next).then(() => ({ req, next }));
}

test('JWT authenticates from current PostgreSQL session, not client role', async () => {
  const token = signToken(customer, sessionHash);
  const { req, next } = await callAuth(token);
  expect(next).toHaveBeenCalledWith();
  expect(req.user).toMatchObject({ id: 12, role: 'customer', stallId: null });
  expect(req.authMethod).toBe('bearer');
  expect(findActiveSession).toHaveBeenCalledWith(sessionHash);
  expect(requireRole('customer')).toBeInstanceOf(Function);
});

test('forged and missing bearer tokens are rejected even with cookie identity', async () => {
  let r = await callAuth(null);
  expect(r.req.user).toBeNull();
  expect(r.next.mock.calls[0][0].status).toBe(401);
  r = await callAuth('malformed.token.value');
  expect(r.next.mock.calls[0][0].status).toBe(401);
});

test('expired or revoked session and changed account role invalidate JWT', async () => {
  const token = signToken(customer, sessionHash);
  let r = await callAuth(token, null);
  expect(r.next.mock.calls[0][0].status).toBe(401);
  r = await callAuth(token, { ...customer, role: 'vendor' });
  expect(r.next.mock.calls[0][0].status).toBe(401);
});
