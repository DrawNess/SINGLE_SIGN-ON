'use strict';

const config = require('../config/env');

class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

function notFound(req, res) {
  res.status(404).json({
    error: 'NotFound',
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const payload = {
    error: err.code || err.name || 'InternalServerError',
    message:
      status >= 500 && config.isProd
        ? 'Internal server error'
        : err.message || 'Error desconocido',
  };
  if (err.details) payload.details = err.details;

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json(payload);
}

module.exports = { HttpError, notFound, errorHandler };
