'use strict';

const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const {
  loginLimiter,
  registerLimiter,
} = require('../middleware/rateLimit');
const schemas = require('../schemas/auth.schemas');

const router = Router();

router.post(
  '/register',
  registerLimiter,
  validate({ body: schemas.register }),
  controller.register
);

router.post(
  '/login',
  loginLimiter,
  validate({ body: schemas.login }),
  controller.login
);

router.post(
  '/refresh',
  validate({ body: schemas.refresh }),
  controller.refresh
);

router.post(
  '/logout',
  requireAuth(),
  validate({ body: schemas.logout }),
  controller.logout
);

router.get('/me', requireAuth(), controller.me);

module.exports = router;
