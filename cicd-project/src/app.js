const express = require('express');
const createError = require('http-errors');
const path = require('path');
const { toHttpError } = require('./utils/errors');

// Keep the team's existing routes and SCRUM-12 authentication routes.
const somethingRouter = require('./routers/Something.router');
const personRouter = require('./routers/Person.router');
const stallRouter = require('./routers/Stall.router');
const authRouter = require('./routers/Auth.router');
const { loadSession } = require('./middleware/auth-session');

const app = express();
app.use(express.json());

// Resolve only server-side sessions; do not trust a client-supplied user role.
app.use(loadSession);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api/auth', authRouter);
app.use('/somethings', somethingRouter);
app.use('/persons', personRouter);
app.use('/stalls', stallRouter);

// Unknown routes are handled after ALL feature routers.
app.use((req, res, next) => {
  next(createError(404, `Unknown resource ${req.method} ${req.originalUrl}`));
});

// Preserve the team's error conversion for customer browsing responses.
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  const httpError = toHttpError(error);
  if (httpError.status >= 500) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res.status(httpError.status).json({ error: httpError.message });
});

module.exports = app;
