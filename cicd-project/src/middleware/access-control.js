/**
 * Makan Liao - shared authorization middleware.
 *
 * IMPORTANT: req.user must be populated ONLY by trusted server-side
 * authentication/session middleware, never from request headers or JSON input.
 * Wiring that authentication layer into the app is a separate backlog task.
 */
const ROLES = new Set(['customer', 'vendor']);

function authenticatedUser(req) {
  const user = req.user;
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || !ROLES.has(user.role)) {
    return null;
  }
  return user;
}

function requireAuthentication(req, res, next) {
  if (!authenticatedUser(req)) {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  return next();
}

function requireRole(...allowedRoles) {
  if (allowedRoles.length === 0 || allowedRoles.some((role) => !ROLES.has(role))) {
    throw new Error('requireRole needs at least one valid role.');
  }

  return function checkRole(req, res, next) {
    const user = authenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'You do not have access to this feature.' });
    }
    return next();
  };
}

/**
 * Restrict a customer-specific resource, such as GET /customers/:customerId/orders.
 * The route must also query by the authenticated customer ID in its database call.
 */
function requireCustomerAccount(parameterName = 'customerId') {
  return function checkCustomerAccount(req, res, next) {
    const user = authenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    if (user.role !== 'customer' || String(user.id) !== req.params[parameterName]) {
      return res.status(403).json({ error: 'You can only access your own account.' });
    }
    return next();
  };
}

/**
 * Restrict a vendor-specific resource, such as PATCH /stalls/:stallId/menu.
 * A trusted session must load stallId from the database; clients cannot choose it.
 */
function requireVendorStall(parameterName = 'stallId') {
  return function checkVendorStall(req, res, next) {
    const user = authenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    if (
      user.role !== 'vendor' ||
      !Number.isSafeInteger(user.stallId) ||
      user.stallId <= 0 ||
      String(user.stallId) !== req.params[parameterName]
    ) {
      return res.status(403).json({ error: 'You cannot manage this stall.' });
    }
    return next();
  };
}

module.exports = {
  requireAuthentication,
  requireRole,
  requireCustomerAccount,
  requireVendorStall,
};
