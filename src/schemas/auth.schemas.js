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
  birth_date: Joi.date().iso().less('now').optional(),
  departamento: departamento.required(),
  provincia: Joi.string().trim().min(2).max(100).required(),
  ciudad: Joi.string().trim().min(2).max(100).required(),
  calle_avenida: Joi.string().trim().min(2).max(200).required(),
  numero: Joi.string().trim().max(20).required(),
  casa_dpto: Joi.string().trim().max(50).optional().allow(null, ''),
  link_google_maps: Joi.string().uri().max(500).optional().allow(null, ''),
});

const login = Joi.object({
  email: email.required(),
  password: Joi.string().required(),
});

const refresh = Joi.object({
  refresh_token: Joi.string().required(),
});

const logout = Joi.object({
  refresh_token: Joi.string().optional(),
  all_devices: Joi.boolean().optional().default(false),
});

module.exports = { register, login, refresh, logout };
