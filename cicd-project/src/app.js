const express = require('express');
const createError = require('http-errors');
const path = require('path');
const { toHttpError } = require('./utils/errors');

// Keep the team's existing routes, SCRUM-12 authentication routes and the vendor routes.
const somethingRouter = require('./routers/Something.router');
const personRouter = require('./routers/Person.router');
const CustomerStallRouter = require('./routers/customer/Customer.Stall.router.js');
const CustomerOrderRouter = require('./routers/customer/Customer.Order.router.js');
const authRouter = require('./routers/Auth.router');
const profileRouter = require('./routers/Profile.router');
const weeklyStatsRouter = require('./routers/VendorWeekly.router');
const vendorRouter = require('./routers/Vendor.router');
const vendorMenuRouter = require('./routers/Vendor.Menu.router.js');
const vendorOrderRouter = require('./routers/Vendor.Order.router');
const { settingsRouter, notificationsRouter } = require('./routers/Vendor.Settings.router.js');
const ordersRouter = require('./routers/ordersRouter');
const paymentRouter = require('./routers/PaymentRouter.js');
const pickupWindowRouter = require('./routers/pickupWindowRouter');
const vendorOrderStatusRouter = require('./routers/VendorOrdersStatusRouter.js');
const { loadSession } = require('./middleware/auth-session');
const pickupQrRouter = require('./routers/PickupQr.router');
const liveCheckoutRouter = require('./routers/LiveCheckout.router');
const customerReviewRouter = require('./routers/CustomerReview.router');
const customerNotificationsRouter = require('./routers/CustomerNotifications.router');
const roleNotificationsRouter = require('./routers/RoleNotifications.router');

const app = express();

// 1 MB so the vendor pages can send a (shrunken) logo, banner or menu photo as a base64 data URL.
app.use(express.json({ limit: '1mb' }));

// Resolve only server-side sessions; do not trust a client-supplied user role.
app.use(loadSession);

app.use(express.static(path.join(__dirname, 'public')));
// Serve only the two pinned PDF.js browser modules; parsing stays client-side.
app.get('/prototype-exact/pdfjs/:filename', (req, res, next) => {
  const allowed = new Set(['pdf.min.mjs', 'pdf.worker.min.mjs']);
  if (!allowed.has(req.params.filename)) return next();
  return res.type('text/javascript').sendFile(path.join(__dirname, '../node_modules/pdfjs-dist/build', req.params.filename));
});
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api/auth', authRouter);
app.use('/api/pickup', pickupQrRouter);
app.use('/api/live', liveCheckoutRouter);
// Day 12: the existing customer receipt form calls /api/orders/:id/feedback.
app.use('/api/orders', customerReviewRouter);
app.use('/api/notifications', customerNotificationsRouter);
app.use('/api/activity-notifications', roleNotificationsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/vendor/weekly-stats', weeklyStatsRouter);
app.use('/somethings', somethingRouter);
app.use('/persons', personRouter);
app.use('/stalls', CustomerStallRouter);
app.use('/customer-orders', CustomerOrderRouter);


// Integrated order-management routes (mounted before the 404 handler)
app.use('/VendorOrders', vendorOrderRouter);
app.use('/payments', paymentRouter);
app.use('/pickup-windows', pickupWindowRouter);

// Vendor routes: the nested /vendors/:vendorId/... routers go before the /vendors router.
app.use('/vendors/:vendorId/menu', vendorMenuRouter);
app.use('/vendors/:vendorId/orders', vendorOrderStatusRouter);
app.use('/vendors/:vendorId/settings', settingsRouter);
app.use('/vendors/:vendorId/notifications', notificationsRouter);
app.use('/vendors', vendorRouter);

// Integrated order-management routes (mounted before the 404 handler)
app.use('/orders', ordersRouter);
app.use('/vendor-orders', vendorOrderRouter);
app.use('/payments', paymentRouter);
app.use('/pickup-windows', pickupWindowRouter);
app.use((req, res, next) => {
  next(createError(404, `Unknown resource ${req.method} ${req.originalUrl}`));
});

// Global error handler — MUST be last, needs all 4 params
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  // Preserve status codes/messages produced by merged order/payment models.
  const statusCode = error && (error.status || error.statusCode);
  if (statusCode && statusCode >= 400 && statusCode < 500 && error.message) {
    return res.status(statusCode).json({ error: error.message });
  }

  const httpError = createError.isHttpError(error) ? error : toHttpError(error);
  if (httpError.status >= 500) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res.status(httpError.status).json({ error: httpError.message });
});

module.exports = app;