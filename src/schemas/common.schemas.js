'use strict';

const Joi = require('joi');

const uuidV7 = Joi.string()
  .pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  .messages({ 'string.pattern.base': 'Debe ser un UUID v7 válido' });

const email = Joi.string().email({ minDomainSegments: 2 }).max(255).lowercase().trim();

// E.164 Bolivia: +591 + 8 dígitos
const phoneBolivia = Joi.string()
  .pattern(/^\+591[0-9]{8}$/)
  .messages({ 'string.pattern.base': 'Teléfono debe tener formato +591########' });

const password = Joi.string()
  .min(8)
  .max(72) // límite Argon2id seguro
  .pattern(/[A-Z]/, 'mayuscula')
  .pattern(/[a-z]/, 'minuscula')
  .pattern(/[0-9]/, 'numero')
  .messages({
    'string.min': 'Password debe tener al menos 8 caracteres',
    'string.pattern.name': 'Password debe contener al menos una {#name}',
  });

const departamento = Joi.string().valid(
  'La Paz',
  'Cochabamba',
  'Santa Cruz',
  'Oruro',
  'Potosí',
  'Chuquisaca',
  'Tarija',
  'Beni',
  'Pando'
);

module.exports = { uuidV7, email, phoneBolivia, password, departamento };
