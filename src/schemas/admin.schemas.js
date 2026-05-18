'use strict';

const Joi = require('joi');
const { uuidV7, email, password } = require('./common.schemas');

// ============================================================
// Users
// ============================================================

const listUsers = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  page_size: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('pending', 'active', 'suspended', 'deleted').optional(),
  role: Joi.string().valid('client', 'staff', 'admin', 'super_admin').optional(),
  q: Joi.string().trim().min(2).max(100).optional(),
  include_deleted: Joi.boolean().truthy('true').falsy('false').default(false),
});

const userIdParam = Joi.object({
  id: uuidV7.required(),
});

const updateUser = Joi.object({
  status: Joi.string().valid('pending', 'active', 'suspended').optional(),
  roles: Joi.array()
    .items(Joi.string().valid('client', 'staff', 'admin', 'super_admin'))
    .min(1)
    .unique()
    .optional(),
})
  .min(1)
  .messages({
    'object.min': 'Debes enviar al menos status o roles',
  });

// ============================================================
// Audit logs
// ============================================================

const listAuditLogs = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  page_size: Joi.number().integer().min(1).max(100).default(20),
  user_id: uuidV7.optional(),
  actor_id: uuidV7.optional(),
  action: Joi.string().max(100).optional(),
  action_prefix: Joi.string().max(50).optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().greater(Joi.ref('from')).optional(),
});

// ============================================================
// Applications
// ============================================================

const createApplication = Joi.object({
  name: Joi.string().trim().min(3).max(100).pattern(/^[a-z0-9-]+$/).required()
    .messages({ 'string.pattern.base': 'name debe ser slug (a-z, 0-9, -)' }),
  display_name: Joi.string().trim().min(3).max(150).required(),
  client_id: Joi.string().trim().min(5).max(100).pattern(/^[a-z0-9_-]+$/).required(),
  type: Joi.string().valid('spa-web', 'mobile', 'desktop', 'service').required(),
  audience: Joi.string().trim().min(2).max(100).required(),
  allowed_origins: Joi.array().items(Joi.string().uri()).default([]),
  allowed_redirect_uris: Joi.array().items(Joi.string().uri()).default([]),
  is_active: Joi.boolean().default(true),
});

const updateApplication = Joi.object({
  display_name: Joi.string().trim().min(3).max(150).optional(),
  audience: Joi.string().trim().min(2).max(100).optional(),
  allowed_origins: Joi.array().items(Joi.string().uri()).optional(),
  allowed_redirect_uris: Joi.array().items(Joi.string().uri()).optional(),
  is_active: Joi.boolean().optional(),
}).min(1);

const listApplications = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  page_size: Joi.number().integer().min(1).max(100).default(20),
  type: Joi.string().valid('spa-web', 'mobile', 'desktop', 'service').optional(),
  is_active: Joi.boolean().truthy('true').falsy('false').optional(),
  q: Joi.string().trim().min(2).max(100).optional(),
  include_deleted: Joi.boolean().truthy('true').falsy('false').default(false),
});

const appIdParam = Joi.object({
  id: uuidV7.required(),
});

// ============================================================
// Invitations
// ============================================================

const createInvitation = Joi.object({
  email: email.required(),
  role: Joi.string().valid('staff', 'admin', 'super_admin').required(),
});

const listInvitations = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  page_size: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('pending', 'accepted', 'revoked', 'expired').optional(),
  email: email.optional(),
});

const invitationIdParam = Joi.object({
  id: uuidV7.required(),
});

// ============================================================
// Sessions
// ============================================================

const userIdParamSessions = Joi.object({
  userId: uuidV7.required(),
});

const sessionIdParam = Joi.object({
  id: uuidV7.required(),
});

const listSessions = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  page_size: Joi.number().integer().min(1).max(100).default(20),
  include_revoked: Joi.boolean().truthy('true').falsy('false').default(false),
});

// ============================================================
// Accept invitation (público, no admin pero relacionado)
// ============================================================

const acceptInvitation = Joi.object({
  token: Joi.string().min(20).max(200).required(),
  password: password.required(),
  first_name: Joi.string().trim().min(2).max(100).required(),
  last_name: Joi.string().trim().min(2).max(100).required(),
  job_title: Joi.string().trim().max(100).optional().allow(null, ''),
  department: Joi.string().trim().max(100).optional().allow(null, ''),
  phone: Joi.string().trim().max(20).optional().allow(null, ''),
});

module.exports = {
  // users
  listUsers,
  userIdParam,
  updateUser,
  // audit
  listAuditLogs,
  // applications
  createApplication,
  updateApplication,
  listApplications,
  appIdParam,
  // invitations
  createInvitation,
  listInvitations,
  invitationIdParam,
  acceptInvitation,
  // sessions
  userIdParamSessions,
  sessionIdParam,
  listSessions,
};
