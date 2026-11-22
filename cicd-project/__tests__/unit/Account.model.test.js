jest.mock('../../src/models/db', () => ({ query: jest.fn(), connect: jest.fn() }));
const pool = require('../../src/models/db');
const { findAccountByEmail, createCustomerAccount } = require('../../src/models/Account.model');

beforeEach(() => jest.clearAllMocks());

test('looks up active prototype users with scrypt hashes and normalises bigint ids', async () => {
  pool.query.mockResolvedValue({
    rows: [
      {
        id: '12',
        email: 'alex@example.com',
        name: 'Alex',
        role: 'customer',
        passwordHash: 'scrypt$v1$sample',
        isActive: 1,
        stallId: null,
      },
    ],
  });
  const account = await findAccountByEmail(' ALEX@example.com ');
  expect(account).toMatchObject({
    id: 12,
    email: 'alex@example.com',
    isActive: true,
    stallId: null,
  });
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM users u'), [
    'ALEX@example.com',
  ]);
});

test('returns null when the email does not exist or was empty', async () => {
  pool.query.mockResolvedValue({ rows: [] });
  await expect(findAccountByEmail('missing@example.com')).resolves.toBeNull();
  pool.query.mockClear();
  await expect(findAccountByEmail('   ')).resolves.toBeNull();
  expect(pool.query).not.toHaveBeenCalled();
});

test('creates a customer using one transactional INSERT into prototype users', async () => {
  const client = { query: jest.fn(), release: jest.fn() };
  client.query
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      rows: [
        { id: '15', email: 'alex@example.com', name: 'Alex', role: 'customer', stallId: null },
      ],
    })
    .mockResolvedValueOnce({});
  pool.connect.mockResolvedValue(client);
  const account = await createCustomerAccount({
    displayName: 'Alex',
    email: 'alex@example.com',
    passwordHash: 'scrypt$v1$example',
  });
  expect(account).toEqual({
    id: 15,
    email: 'alex@example.com',
    name: 'Alex',
    role: 'customer',
    stallId: null,
    stallName: null,
  });
  expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
  expect(client.query.mock.calls[1][0]).toContain('INSERT INTO users');
  expect(client.query.mock.calls[1][1]).toEqual([
    'alex@example.com',
    'scrypt$v1$example',
    'Alex',
    expect.any(String),
  ]);
  expect(client.query).toHaveBeenNthCalledWith(3, 'COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('rolls back a failed users INSERT and releases client', async () => {
  const client = { query: jest.fn(), release: jest.fn() };
  client.query
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error('DB error'))
    .mockResolvedValueOnce({});
  pool.connect.mockResolvedValue(client);
  await expect(
    createCustomerAccount({ displayName: 'Alex', email: 'alex@example.com', passwordHash: 'hash' }),
  ).rejects.toThrow('DB error');
  expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
});
