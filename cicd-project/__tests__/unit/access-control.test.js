const {
  requireAuthentication,
  requireRole,
  requireCustomerAccount,
  requireVendorStall,
} = require('../../src/middleware/access-control');

function fakeResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function check(middleware, request) {
  const res = fakeResponse();
  const next = jest.fn();
  middleware(request, res, next);
  return { res, next };
}

const customer = { id: 11, role: 'customer' };
const vendor = { id: 22, role: 'vendor', stallId: 7 };

describe('Shared platform role-based access', () => {
  test('rejects an unauthenticated request with 401', () => {
    const { res, next } = check(requireAuthentication, {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('does not trust a client-supplied role header', () => {
    const { res, next } = check(requireRole('vendor'), {
      headers: { 'x-role': 'vendor' },
    });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a malformed authenticated user', () => {
    const { res, next } = check(requireAuthentication, { user: { id: '11', role: 'customer' } });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows an authenticated customer', () => {
    const { next } = check(requireAuthentication, { user: customer });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('permits a customer to enter customer-only routes', () => {
    const { next } = check(requireRole('customer'), { user: customer });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('blocks a customer from vendor-only routes with 403', () => {
    const { res, next } = check(requireRole('vendor'), { user: customer });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('permits a vendor to enter vendor-only routes', () => {
    const { next } = check(requireRole('vendor'), { user: vendor });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('permits an authenticated admin only on explicitly admin-enabled routes', () => {
    const { next } = check(requireRole('admin'), { user: { id: 1, role: 'admin' } });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('fails fast when an unrecognised role is configured', () => {
    expect(() => requireRole('owner')).toThrow('valid role');
  });

  test('allows a customer to access their own account route', () => {
    const { next } = check(requireCustomerAccount(), {
      user: customer,
      params: { customerId: '11' },
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('blocks a customer from another customer account', () => {
    const { res, next } = check(requireCustomerAccount(), {
      user: customer,
      params: { customerId: '12' },
    });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('blocks a vendor from a customer account route', () => {
    const { res } = check(requireCustomerAccount(), {
      user: vendor,
      params: { customerId: '22' },
    });
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('allows a vendor to manage their assigned stall', () => {
    const { next } = check(requireVendorStall(), {
      user: vendor,
      params: { stallId: '7' },
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('blocks a vendor from another vendor stall', () => {
    const { res, next } = check(requireVendorStall(), {
      user: vendor,
      params: { stallId: '8' },
    });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('blocks a vendor without an assigned stall', () => {
    const { res } = check(requireVendorStall(), {
      user: { id: 22, role: 'vendor' },
      params: { stallId: '7' },
    });
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('blocks a customer from managing any stall', () => {
    const { res } = check(requireVendorStall(), {
      user: customer,
      params: { stallId: '7' },
    });
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
