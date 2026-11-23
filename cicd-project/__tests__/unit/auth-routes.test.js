jest.mock('../../src/services/login-service', () => ({ authenticateAccount: jest.fn() }));
jest.mock('../../src/services/registration-service', () => ({
  registerCustomerAccount: jest.fn(),
}));
jest.mock('../../src/models/Session.model', () => ({
  createSession: jest.fn(),
  findActiveSession: jest.fn(),
  revokeSession: jest.fn(),
}));
const request = require('supertest');
const app = require('../../src/app');
const { authenticateAccount } = require('../../src/services/login-service');
const { registerCustomerAccount } = require('../../src/services/registration-service');
const {
  createSession,
  findActiveSession,
  revokeSession,
} = require('../../src/models/Session.model');

const account = {
  id: 7,
  email: 'test@example.com',
  name: 'Test Customer',
  role: 'customer',
  stallId: null,
};
const signup = {
  displayName: 'Test Customer',
  email: 'test@example.com',
  password: 'correct-horse-123',
  confirmPassword: 'correct-horse-123',
};
const csrf = 'b'.repeat(64);
const publicUser = {
  id: 7,
  email: 'test@example.com',
  displayName: 'Test Customer',
  phone: '',
  role: 'customer',
  stallId: null,
  stallName: null,
  active: true,
};

beforeEach(() => {
  jest.resetAllMocks();
  findActiveSession.mockResolvedValue(null);
  createSession.mockResolvedValue();
  revokeSession.mockResolvedValue();
});

test('signup creates customer session and returns prototype-compatible user and CSRF', async () => {
  registerCustomerAccount.mockResolvedValue({
    created: true,
    account: { ...account, passwordHash: 'never-expose' },
    errors: {},
  });
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ ...signup, role: 'admin' });
  expect(res.status).toBe(201);
  expect(res.body.user).toEqual(publicUser);
  expect(res.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
});

test('signup rejects invalid fields and duplicate emails', async () => {
  registerCustomerAccount
    .mockResolvedValueOnce({ created: false, errors: { password: 'Invalid.' } })
    .mockResolvedValueOnce({
      created: false,
      errors: { email: 'An account with this email already exists.' },
    });
  expect((await request(app).post('/api/auth/signup').send(signup)).status).toBe(400);
  expect((await request(app).post('/api/auth/signup').send(signup)).status).toBe(409);
});

test('login rejects incorrect credentials without creating cookies', async () => {
  authenticateAccount.mockResolvedValue({
    authenticated: false,
    errors: { form: 'Incorrect email or password.' },
  });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: signup.email, password: signup.password });
  expect(res.status).toBe(401);
  expect(res.headers['set-cookie']).toBeUndefined();
});

test('login issues an opaque cookie and a distinct CSRF token', async () => {
  authenticateAccount.mockResolvedValue({ authenticated: true, account, errors: {} });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: signup.email, password: signup.password });
  expect(res.status).toBe(200);
  expect(res.body.user).toEqual(publicUser);
  expect(res.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(createSession.mock.calls[0][1]).toMatch(/^[a-f0-9]{64}$/);
  expect(res.headers['set-cookie'][0]).not.toContain(createSession.mock.calls[0][1]);
});

test('GET me is safe for a guest and never trusts forged identity headers', async () => {
  const res = await request(app).get('/api/auth/me').set('x-role', 'admin').set('x-user-id', '1');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ user: null, csrfToken: null });
});

test('GET me returns the authenticated database user with CSRF token', async () => {
  findActiveSession.mockResolvedValue({ ...account, csrfToken: csrf });
  const res = await request(app)
    .get('/api/auth/me')
    .set('Cookie', `ml_session=${'a'.repeat(64)}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ user: publicUser, csrfToken: csrf });
});

test('logout requires a valid CSRF token before deleting the session', async () => {
  findActiveSession.mockResolvedValue({ ...account, csrfToken: csrf });
  const noCsrf = await request(app)
    .post('/api/auth/logout')
    .set('Cookie', `ml_session=${'a'.repeat(64)}`)
    .send({});
  expect(noCsrf.status).toBe(403);
  expect(revokeSession).not.toHaveBeenCalled();
  const res = await request(app)
    .post('/api/auth/logout')
    .set('Cookie', `ml_session=${'a'.repeat(64)}`)
    .set('X-CSRF-Token', csrf)
    .send({});
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
  expect(revokeSession).toHaveBeenCalledTimes(1);
  expect(res.headers['set-cookie'][0]).toContain('Max-Age=0');
});

test('rejects cross-origin credentials and non-JSON POST requests', async () => {
  const x = await request(app)
    .post('/api/auth/login')
    .set('Origin', 'https://attacker.invalid')
    .send({ email: signup.email, password: signup.password });
  expect(x.status).toBe(403);
  const form = await request(app)
    .post('/api/auth/login')
    .type('form')
    .send({ email: signup.email, password: signup.password });
  expect(form.status).toBe(415);
  expect(authenticateAccount).not.toHaveBeenCalled();
});
