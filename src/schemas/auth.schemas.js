'use strict';

const Joi = require('joi');
const { email, phoneBolivia, password, departamento } = require('./common.schemas');

const register = Joi.object({
  email: email.required(),
  password: password.required(),
  first_name: Joi.string().trim().min(2).max(100).required(),
  last_name: Joi.string().trim().min(2).max(100).required(),
  phone: phoneBolivia.required(),
  document_type: Joi.string().valid('CI', 'NIT').optional(),
  document_number: Joi.string().trim().max(20).when('document_type', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  razon_social: Joi.string().trim().max(200).when('document_type', {
    is: 'NIT',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  birth_date: Joi.date().iso().less('now').raw().optional(),
  departamento: departamento.optional().allow(null, ''),
  provincia: Joi.string().trim().min(2).max(100).optional().allow(null, ''),
  ciudad: Joi.string().trim().min(2).max(100).optional().allow(null, ''),
  calle_avenida: Joi.string().trim().min(2).max(200).optional().allow(null, ''),
  numero: Joi.string().trim().max(20).optional().allow(null, ''),
  casa_dpto: Joi.string().trim().max(50).optional().allow(null, ''),
  link_google_maps: Joi.string().uri().max(500).optional().allow(null, ''),
});

const login = Joi.object({
  email: email.required(),
  password: Joi.string().required(),
});

// refresh_token puede venir en body O en cookie httpOnly (spa-web).
// El controller decide cuál usar. Schema lo deja opcional aquí.
const refresh = Joi.object({
  refresh_token: Joi.string().optional(),
});

const logout = Joi.object({
  refresh_token: Joi.string().optional(),
  all_devices: Joi.boolean().optional().default(false),
});

const verifyEmailBody = Joi.object({
  token: Joi.string().min(20).max(200).required(),
});

const verifyEmailQuery = Joi.object({
  token: Joi.string().min(20).max(200).required(),
});

const resendVerification = Joi.object({
  email: email.required(),
});

const changeEmail = Joi.object({
  new_email: email.required(),
  current_password: Joi.string().required(),
});

const forgotPassword = Joi.object({
  email: email.required(),
});

const resetPassword = Joi.object({
  token: Joi.string().min(20).max(200).required(),
  new_password: password.required(),
});

const changePassword = Joi.object({
  current_password: Joi.string().required(),
  new_password: password.required(),
});

// ============================================================
// Self-service del user (PATCH /auth/me, sessions)
// ============================================================

const updateMyProfile = Joi.object({
  // Comunes (client + admin)
  first_name: Joi.string().trim().min(2).max(100).optional(),
  last_name: Joi.string().trim().min(2).max(100).optional(),

  // Client-only
  phone: Joi.string().trim().max(20).optional(),
  birth_date: Joi.date().iso().less('now').raw().optional(),
  document_type: Joi.string().valid('CI', 'NIT').optional().allow(null),
  document_number: Joi.string().trim().max(20).optional().allow(null, ''),
  razon_social: Joi.string().trim().max(200).optional().allow(null, ''),
  departamento: departamento.optional(),
  provincia: Joi.string().trim().min(2).max(100).optional(),
  ciudad: Joi.string().trim().min(2).max(100).optional(),
  calle_avenida: Joi.string().trim().min(2).max(200).optional(),
  numero: Joi.string().trim().max(20).optional(),
  casa_dpto: Joi.string().trim().max(50).optional().allow(null, ''),
  link_google_maps: Joi.string().uri().max(500).optional().allow(null, ''),

  // Admin-only
  job_title: Joi.string().trim().max(100).optional().allow(null, ''),
  department: Joi.string().trim().max(100).optional().allow(null, ''),
})
  .min(1)
  .messages({ 'object.min': 'Debes enviar al menos un campo a actualizar' });

const sessionIdParam = Joi.object({
  id: Joi.string()
    .pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    .required(),
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  verifyEmailBody,
  verifyEmailQuery,
  resendVerification,
  changeEmail,
  updateMyProfile,
  sessionIdParam,
  forgotPassword,
  resetPassword,
  changePassword,
};
