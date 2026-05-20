'use strict';

const { Router } = require('express');
const controller = require('../controllers/internal.controller');
const validate = require('../middleware/validate');
const { requireApiKey } = require('../middleware/apiKey');
const Joi = require('joi');
const { uuidV7, email } = require('../schemas/common.schemas');

const router = Router();

// Endpoints s2s — autenticación SOLO por API key (sk_live_*)
// NO aceptan JWT de usuario.

// Echo endpoint (sin scope específico, solo válida key)
router.get('/whoami', requireApiKey(), controller.whoAmI);

// User detail — requiere scope users:read
router.get('/users/:id',
  requireApiKey('users:read'),
  validate({ params: Joi.object({ id: uuidV7.required() }) }),
  controller.getUserById
);

// User list — requiere scope users:list
router.get('/users',
  requireApiKey('users:list'),
  validate({
    query: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      page_size: Joi.number().integer().min(1).max(100).default(20),
      status: Joi.string().valid('pending', 'active', 'suspended').optional(),
      email: email.optional(),
    }),
  }),
  controller.listUsers
);

module.exports = router;
