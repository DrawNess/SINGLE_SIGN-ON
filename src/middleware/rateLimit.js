'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config/env');

const baseOpts = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Silenciar falso positivo: nuestros keyGenerator SÍ usan ipKeyGenerator.
  validate: { keyGeneratorIpFallback: false },
  message: {
    error: 'TooManyRequests',
    message: 'Demasiadas peticiones. Intenta más tarde.',
  },
};

const loginLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 1000,
  limit: config.rateLimit.loginPerMin,
  keyGenerator: (req) => {
    const email = (req.body?.email || '').toLowerCase();
    return `login:${ipKeyGenerator(req)}:${email}`;
  },
});

const forgotPasswordLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 60 * 1000,
  limit: config.rateLimit.forgotPerHour,
  keyGenerator: (req) =>
    `forgot:${(req.body?.email || '').toLowerCase()}`,
});

const registerLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 60 * 1000,
  limit: config.rateLimit.registerPerHour,
  keyGenerator: (req) => `register:${ipKeyGenerator(req)}`,
});

module.exports = { loginLimiter, forgotPasswordLimiter, registerLimiter };
