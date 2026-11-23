jest.mock('../../src/models/Session.model', () => ({
  findActiveSession: jest.fn(),
  createSession: jest.fn(),
}));
const { findActiveSession, createSession } = require('../../src/models/Session.model');
const {
  loadSession,
  startSession,
  clearSession,
  readSessionToken,
  hashToken,
  requireCsrf,
} = require('../../src/middleware/auth-session');

beforeEach(() => jest.resetAllMocks());

function fakeResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

test('rejects malformed cookies and reads real opaque tokens', () => {
  expect(readSessionToken({ headers: {} })).toBeNull();
  expect(readSessionToken({ headers: { cookie: 'ml_session=hello' } })).toBeNull();
  expect(readSessionToken({ headers: { cookie: 'x'.repeat(9000) } })).toBeNull();
  expect(
    readSessionToken({ headers: { cookie: `theme=dark; ml_session=${'f'.repeat(64)}` } }),
  ).toBe('f'.repeat(64));
  expect(hashToken('a'.repeat(64))).not.toBe('a'.repeat(64));
});

test('loads identity, stall and CSRF exclusively from database session', async () => {
  findActiveSession.mockResolvedValue({
    id: 10,
    name: 'Ada',
    email: 'ada@example.com',
    role: 'vendor',
    stallId: 7,
    csrfToken: 'b'.repeat(64),
  });
  const req = {
    headers: { cookie: `ml_session=${'a'.repeat(64)}` },
    user: { id: 999, role: 'admin' },
  };
  const next = jest.fn();
  await loadSession(req, {}, next);
  expect(req.user).toMatchObject({ id: 10, role: 'vendor', stallId: 7 });
  expect(req.user).not.toHaveProperty('csrfToken');
  expect(req.csrfToken).toBe('b'.repeat(64));
  expect(req.sessionTokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(next).toHaveBeenCalledWith();
});

test('loads a legitimate staff session from the database', async () => {
  findActiveSession.mockResolvedValue({
    id: 25,
    name: 'Staff Member',
    email: 'staff@example.com',
    role: 'staff',
    stallId: null,
    csrfToken: 'b'.repeat(64),
  });
  const req = { headers: { cookie: `ml_session=${'a'.repeat(64)}` } };
  const next = jest.fn();

  await loadSession(req, {}, next);

  expect(req.user).toMatchObject({ id: 25, role: 'staff', stallId: null });
  expect(req.user).not.toHaveProperty('csrfToken');
  expect(req.csrfToken).toBe('b'.repeat(64));
  expect(next).toHaveBeenCalledWith();
});

test('does not authenticate an unknown database role', async () => {
  findActiveSession.mockResolvedValue({
    id: 26,
    name: 'Unknown Role',
    email: 'unknown@example.com',
    role: 'superuser',
    stallId: null,
    csrfToken: 'b'.repeat(64),
  });
  const req = { headers: { cookie: `ml_session=${'a'.repeat(64)}` } };
  const next = jest.fn();

  await loadSession(req, {}, next);

  expect(req.user).toBeNull();
  expect(next).toHaveBeenCalledWith();
});

test('rejects expired or forged identity and passes database errors to handler', async () => {
  findActiveSession.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('DB down'));
  const req = {
    headers: { cookie: `ml_session=${'a'.repeat(64)}` },
    user: { id: 999, role: 'admin' },
  };
  const next = jest.fn();
  await loadSession(req, {}, next);
  expect(req.user).toBeNull();
  expect(req.csrfToken).toBeNull();
  await loadSession(req, {}, next);
  expect(next).toHaveBeenLastCalledWith(expect.any(Error));
});

test('sets cookie only after persistent session and returns a CSRF token', async () => {
  createSession.mockResolvedValue();
  const res = { set: jest.fn() };
  const csrf = await startSession(res, { id: 3 });
  expect(csrf).toMatch(/^[a-f0-9]{64}$/);
  expect(createSession).toHaveBeenCalledWith(
    3,
    expect.stringMatching(/^[a-f0-9]{64}$/),
    expect.any(Date),
    csrf,
  );
  expect(res.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly'));
  clearSession(res);
  expect(res.set).toHaveBeenLastCalledWith('Set-Cookie', expect.stringContaining('Max-Age=0'));
});

test('enforces a CSRF token for authenticated state changes', () => {
  const csrf = 'b'.repeat(64);
  const res = fakeResponse();
  const next = jest.fn();
  requireCsrf({ get: () => null, csrfToken: csrf }, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
  requireCsrf({ get: () => csrf, csrfToken: csrf }, res, next);
  expect(next).toHaveBeenCalledTimes(1);
});
