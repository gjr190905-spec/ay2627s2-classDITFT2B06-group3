const createError = require('http-errors');

const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
});

const ERROR_DEFINITIONS = Object.freeze({
  INVALID_INPUT: { status: 400, message: 'Invalid input' },
  UNAUTHENTICATED: { status: 401, message: 'Please log in' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  CONFLICT: { status: 409, message: 'Conflict' },
});

const PG_ERROR_CODES = Object.freeze({
  23505: ERROR_CODES.CONFLICT,
  23503: ERROR_CODES.CONFLICT, 
  23514: ERROR_CODES.INVALID_INPUT,
  22003: ERROR_CODES.INVALID_INPUT,
  '22P02': ERROR_CODES.INVALID_INPUT, 
});

function mapError(code, message) {
  const definition = ERROR_DEFINITIONS[code];
  if (!definition) {
    throw new Error(`Unknown error code: ${code}`);
  }
  if (message) {
    return createError(definition.status, message);
  }
  return createError(definition.status, definition.message);
}

function toHttpError(error) {
  if (createError.isHttpError(error)) {
    return error;
  }
  const mappedCode = error && PG_ERROR_CODES[error.code];
  if (mappedCode) {
    return mapError(mappedCode);
  }
  return createError(500, 'Internal server error');
}

module.exports = { ERROR_CODES, mapError, toHttpError };