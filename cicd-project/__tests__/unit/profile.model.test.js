jest.mock('../../src/models/db', () => ({ query: jest.fn() }));
const pool = require('../../src/models/db');
const { findProfileById, updateProfileById } = require('../../src/models/Profile.model');
const row = {
  id: '9', email: 'customer@example.com', displayName: 'Sample Customer',
  phone: null, role: 'customer', stallId: null, stallName: null,
};

beforeEach(() => jest.resetAllMocks());

test('loads a real PostgreSQL users row by authenticated ID', async () => {
  pool.query.mockResolvedValueOnce({ rows: [row] });
  const profile = await findProfileById(9);
  expect(profile).toEqual({ id: 9, email: row.email, displayName: row.displayName, phone: '', role: 'customer', stallId: null, stallName: null, active: true, avatarUrl: null });
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE u.id = $1'), [9]);
});

test('writes only display name and phone to the logged-in user, then rereads', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ id: 9 }] });
  pool.query.mockResolvedValueOnce({ rows: [{ ...row, displayName: 'Changed Name', phone: '81234567' }] });
  const result = await updateProfileById(9, 'Changed Name', '81234567');
  expect(pool.query.mock.calls[0][0]).toContain('WHERE id = $1 AND is_active = 1');
  expect(pool.query.mock.calls[0][1]).toEqual([9, 'Changed Name', '81234567']);
  expect(result.displayName).toBe('Changed Name');
  expect(result.phone).toBe('81234567');
});

test('rejects unsafe account IDs before issuing SQL', async () => {
  await expect(findProfileById('9 OR 1=1')).rejects.toThrow('Invalid account ID.');
  expect(pool.query).not.toHaveBeenCalled();
});

test('does not report a successful update when the account no longer exists', async () => {
  pool.query.mockResolvedValueOnce({ rows: [] });
  expect(await updateProfileById(9, 'Changed Name', '')).toBeNull();
});
