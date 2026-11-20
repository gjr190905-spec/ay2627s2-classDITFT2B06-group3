jest.mock('../../src/models/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../../src/models/db');
const { findAccountByEmail, createCustomerAccount } = require('../../src/models/Account.model');

describe('SCRUM-12 account persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('finds a registered account using its email', async () => {
    const account = {
      id: 1,
      email: 'alex@example.com',
      name: 'Alex',
      role: 'customer',
      passwordHash: 'stored-hash',
    };

    pool.query.mockResolvedValue({ rows: [account] });

    const result = await findAccountByEmail(' ALEX@example.com ');

    expect(result).toEqual(account);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('LOWER(p."email")'), [
      'ALEX@example.com',
    ]);
  });

  test('returns null when the account does not exist', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await expect(findAccountByEmail('missing@example.com')).resolves.toBeNull();
  });

  test('rejects empty email lookups without querying the database', async () => {
    await expect(findAccountByEmail('   ')).resolves.toBeNull();

    expect(pool.query).not.toHaveBeenCalled();
  });

  test('creates a customer and stores the password hash', async () => {
    const person = {
      id: 10,
      email: 'alex@example.com',
      name: 'Alex',
      avatar: null,
      role: 'customer',
    };

    const client = {
      query: jest.fn(),
      release: jest.fn(),
    };

    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [person] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    pool.connect.mockResolvedValue(client);

    const result = await createCustomerAccount({
      displayName: 'Alex',
      email: 'alex@example.com',
      passwordHash: 'example-stored-bcrypt-hash',
    });

    expect(result).toEqual(person);

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');

    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO "Person"'),
      ['alex@example.com', 'Alex'],
    );

    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO "PersonCredential"'),
      [10, 'example-stored-bcrypt-hash'],
    );

    expect(client.query).toHaveBeenNthCalledWith(4, 'COMMIT');

    expect(result.passwordHash).toBeUndefined();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back when credential storage fails', async () => {
    const client = {
      query: jest.fn(),
      release: jest.fn(),
    };

    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockRejectedValueOnce(new Error('database failure'))
      .mockResolvedValueOnce({});

    pool.connect.mockResolvedValue(client);

    await expect(
      createCustomerAccount({
        displayName: 'Alex',
        email: 'alex@example.com',
        passwordHash: 'example-stored-bcrypt-hash',
      }),
    ).rejects.toThrow('database failure');

    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');

    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
