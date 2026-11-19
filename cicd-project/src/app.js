const express = require('express');
const createError = require('http-errors');
const path = require('path');
const { toHttpError } = require('./utils/errors');

// Import route handlers
const somethingRouter = require('./routers/Something.router');
const personRouter = require('./routers/Person.router');
const stallRouter = require('./routers/Stall.router');


const app = express();

// Parse incoming JSON request bodies (e.g. from POST/PUT requests)
app.use(express.json());

// Serve static files (HTML, CSS, JS, images) from the 'public' folder.
// e.g. src/public/index.html is accessible at http://localhost:<port>/
app.use(express.static(path.join(__dirname, 'public')));

// Browsers automatically request /favicon.ico — return 204 (no content) to avoid 404 noise.
app.get('/favicon.ico', (req, res) => res.status(204).end());


app.use('/somethings', somethingRouter);
app.use('/persons', personRouter);
app.use('/stalls', stallRouter);

// 404 handler — MUST come before error handler
app.use((req, res, next) => {
  next(createError(404, `Unknown resource ${req.method} ${req.originalUrl}`));
});

// Global error handler — MUST be last, needs all 4 params
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