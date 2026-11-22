jest.mock('../../src/models/db', () => ({ query: jest.fn() }));
const pool = require('../../src/models/db');
const {
  createSession,
  findActiveSession,
  revokeSession,
} = require('../../src/models/Session.model');

beforeEach(() => jest.clearAllMocks());

test('stores only a token hash with a CSRF token and ISO timestamps', async () => {
  pool.query.mockResolvedValue({});

  await createSession(5, 'a'.repeat(64), new Date('2026-11-30T00:00:00.000Z'), 'b'.repeat(64));

  expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO sessions');
  expect(pool.query.mock.calls[0][1]).toEqual([
    'a'.repeat(64),
    5,
    'b'.repeat(64),
    '2026-11-30T00:00:00.000Z',
    expect.any(String),
  ]);
});

test('resolves active accounts and safely converts PostgreSQL bigint IDs', async () => {
  pool.query.mockResolvedValue({
    rows: [
      {
        id: '7',
        name: 'Vendor',
        email: 'vendor@example.com',
        role: 'vendor',
        stallId: '18',
        csrfToken: 'a'.repeat(64),
      },
    ],
  });

  const account = await findActiveSession('f'.repeat(64));

  expect(account).toMatchObject({
    id: 7,
    role: 'vendor',
    stallId: 18,
  });

  expect(pool.query.mock.calls[0][0]).toContain('u.is_active = 1');
  expect(pool.query.mock.calls[0][0]).toContain('sess.expires_at > $2');
});

test('rejects missing and unsafe account IDs', async () => {
  pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
    rows: [{ id: '9007199254740993', stallId: null }],
  });

  await expect(findActiveSession('a')).resolves.toBeNull();
  await expect(findActiveSession('b')).rejects.toThrow('Unsupported user ID');
});

test('revokes sessions by hashed token', async () => {
  pool.query.mockResolvedValue({});

  await revokeSession('a'.repeat(64));

  expect(pool.query).toHaveBeenCalledWith('DELETE FROM sessions WHERE token_hash = $1', [
    'a'.repeat(64),
  ]);
});
