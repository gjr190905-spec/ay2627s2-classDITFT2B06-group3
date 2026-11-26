jest.mock('../../src/models/Profile.model', () => ({
  findProfileById: jest.fn(),
  updateProfileById: jest.fn(),
}));
jest.mock('../../src/models/Session.model', () => ({
  createSession: jest.fn(),
  findActiveSession: jest.fn(),
  revokeSession: jest.fn(),
}));

const request = require('supertest');
const app = require('../../src/app');
const { findActiveSession } = require('../../src/models/Session.model');
const { findProfileById, updateProfileById } = require('../../src/models/Profile.model');

const csrf = 'c'.repeat(64);
const cookie = `ml_session=${'a'.repeat(64)}`;
const profile = {
  id: 9, email: 'customer@example.com', displayName: 'Sample Customer',
  phone: '', role: 'customer', stallId: null, stallName: null, active: true,
};

beforeEach(() => {
  jest.resetAllMocks();
  findActiveSession.mockResolvedValue({ id: 9, name: 'Sample Customer', email: profile.email, role: 'customer', stallId: null, csrfToken: csrf });
  findProfileById.mockResolvedValue(profile);
  updateProfileById.mockResolvedValue({ ...profile, displayName: 'Updated Customer', phone: '+65 8123 4567' });
});

test('guest cannot read or edit profile', async () => {
  findActiveSession.mockResolvedValue(null);
  const read = await request(app).get('/api/profile');
  const edit = await request(app).patch('/api/profile').send({ displayName: 'Intruder' });
  expect(read.status).toBe(401);
  expect(edit.status).toBe(401);
  expect(findProfileById).not.toHaveBeenCalled();
  expect(updateProfileById).not.toHaveBeenCalled();
});

test('signed-in user reads only their own database profile, without a password hash', async () => {
  const res = await request(app).get('/api/profile').set('Cookie', cookie);
  expect(res.status).toBe(200);
  expect(res.body.user).toEqual(profile);
  expect(findProfileById).toHaveBeenCalledWith(9);
  expect(JSON.stringify(res.body)).not.toContain('passwordHash');
});

test('missing CSRF token blocks profile editing', async () => {
  const res = await request(app).patch('/api/profile').set('Cookie', cookie).send({ displayName: 'Updated Customer' });
  expect(res.status).toBe(403);
  expect(updateProfileById).not.toHaveBeenCalled();
});

test('forged cross-site origin blocks profile editing', async () => {
  const res = await request(app).patch('/api/profile')
    .set('Cookie', cookie).set('Origin', 'https://evil.example')
    .set('X-CSRF-Token', csrf).send({ displayName: 'Updated Customer' });
  expect(res.status).toBe(403);
  expect(updateProfileById).not.toHaveBeenCalled();
});

test('does not let customers change role, ID, email or stall assignments', async () => {
  const res = await request(app).patch('/api/profile').set('Cookie', cookie)
    .set('X-CSRF-Token', csrf)
    .send({ displayName: 'Updated Customer', role: 'admin', id: 1 });
  expect(res.status).toBe(400);
  expect(updateProfileById).not.toHaveBeenCalled();
});

test('rejects invalid display names and phone numbers', async () => {
  const res = await request(app).patch('/api/profile').set('Cookie', cookie)
    .set('X-CSRF-Token', csrf)
    .send({ displayName: 'X', phone: 'abc123' });
  expect(res.status).toBe(400);
  expect(res.body.errors).toHaveProperty('displayName');
  expect(res.body.errors).toHaveProperty('phone');
  expect(updateProfileById).not.toHaveBeenCalled();
});

test('updates the authenticated customer and returns saved details', async () => {
  const res = await request(app).patch('/api/profile').set('Cookie', cookie)
    .set('X-CSRF-Token', csrf)
    .send({ displayName: '  Updated   Customer  ', phone: ' +65 8123 4567 ' });
  expect(res.status).toBe(200);
  expect(updateProfileById).toHaveBeenCalledWith(9, 'Updated Customer', '+65 8123 4567');
  expect(res.body.user.displayName).toBe('Updated Customer');
  expect(res.body.user.phone).toBe('+65 8123 4567');
});

test('returns 404 for a deleted or inactive account', async () => {
  findProfileById.mockResolvedValue(null);
  const res = await request(app).get('/api/profile').set('Cookie', cookie);
  expect(res.status).toBe(404);
});
