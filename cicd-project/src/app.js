const express = require('express');
const createError = require('http-errors');
const path = require('path');
const { toHttpError } = require('./utils/errors');

// Keep the team's existing routes, SCRUM-12 authentication routes and the vendor routes.
const somethingRouter = require('./routers/Something.router');
const personRouter = require('./routers/Person.router');
const stallRouter = require('./routers/Stall.router');
const authRouter = require('./routers/Auth.router');
const vendorRouter = require('./routers/Vendor.router');
const menuRouter = require('./routers/Menu.router');
const orderRouter = require('./routers/Order.router');
const { settingsRouter, notificationsRouter } = require('./routers/Settings.router');
const { loadSession } = require('./middleware/auth-session');

const app = express();

// 1 MB so the vendor pages can send a (shrunken) logo, banner or menu photo as a base64 data URL.
app.use(express.json({ limit: '1mb' }));

// Resolve only server-side sessions; do not trust a client-supplied user role.
app.use(loadSession);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api/auth', authRouter);
app.use('/somethings', somethingRouter);
app.use('/persons', personRouter);
app.use('/stalls', stallRouter);

// Vendor routes: the nested /vendors/:vendorId/... routers go before the /vendors router.
app.use('/vendors/:vendorId/menu', menuRouter);
app.use('/vendors/:vendorId/orders', orderRouter);
app.use('/vendors/:vendorId/settings', settingsRouter);
app.use('/vendors/:vendorId/notifications', notificationsRouter);
app.use('/vendors', vendorRouter);

// Unknown routes are handled after ALL feature routers.
app.use((req, res, next) => {
  next(createError(404, `Unknown resource ${req.method} ${req.originalUrl}`));
});

// Preserve the team's error conversion for customer browsing responses.
// Errors already made with http-errors (e.g. the vendor controllers' 400/404/409) keep
// their status and message.
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  const httpError = createError.isHttpError(error) ? error : toHttpError(error);
  if (httpError.status >= 500) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res.status(httpError.status).json({ error: httpError.message });
});

module.exports = app;