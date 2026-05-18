'use strict';

const { Op } = require('sequelize');
const { ApiKey, Application } = require('../db/models');
const { sha256 } = require('../utils/hash');
const { generateApiKey } = require('../utils/random');
const auditService = require('./audit.service');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Scopes válidos. Para añadir scope nuevo:
 *   1. Agregarlo aquí
 *   2. Usarlo en el middleware apiKey.js como require
 */
const VALID_SCOPES = [
  'users:read',
  'users:list',
  'applications:read',
  'audit:write',
];

/**
 * Crea una API key para una application.
 * Devuelve { apiKey, plain } — el `plain` SOLO aparece UNA VEZ.
 */
async function createApiKey({ applicationId, name, scopes, expiresAt, actorId, req }) {
  const app = await Application.findByPk(applicationId);
  if (!app) throw new HttpError(404, 'NotFound', 'Application no encontrada');

  // Validar scopes
  const invalid = scopes.filter((s) => !VALID_SCOPES.includes(s));
  if (invalid.length > 0) {
    throw new HttpError(
      400,
      'BadRequest',
      `Scopes inválidos: ${invalid.join(', ')}. Válidos: ${VALID_SCOPES.join(', ')}`
    );
  }

  const { plain, prefix, hash } = generateApiKey();

  const apiKey = await ApiKey.create({
    application_id: app.id,
    name,
    key_prefix: prefix,
    key_hash: hash,
    scopes,
    expires_at: expiresAt || null,
    created_by: actorId,
  });

  await auditService.log({
    action: 'admin.api_key.created',
    actorId,
    actorType: 'admin',
    applicationId: app.id,
    apiKeyId: apiKey.id,
    entity: 'api_keys',
    entityId: apiKey.id,
    metadata: { name, scopes },
    ...auditService.fromRequest(req),
  });

  return { apiKey, plain };
}

async function listApiKeys({ applicationId, q }) {
  const where = {};
  if (applicationId) where.application_id = applicationId;
  if (q.active_only) {
    where.revoked_at = null;
    where[Op.or] = [
      { expires_at: null },
      { expires_at: { [Op.gt]: new Date() } },
    ];
  }

  const { rows, count } = await ApiKey.findAndCountAll({
    where,
    include: [
      { model: Application, as: 'application', attributes: ['id', 'name', 'display_name'] },
    ],
    order: [['created_at', 'DESC']],
    limit: q.pageSize,
    offset: q.offset,
  });

  return { rows, count };
}

async function revokeApiKey(id, { actorId, req }) {
  const key = await ApiKey.findByPk(id);
  if (!key) throw new HttpError(404, 'NotFound', 'API key no encontrada');
  if (key.revoked_at) {
    throw new HttpError(400, 'BadRequest', 'API key ya estaba revocada');
  }

  await key.update({ revoked_at: new Date() });

  await auditService.log({
    action: 'admin.api_key.revoked',
    actorId,
    actorType: 'admin',
    applicationId: key.application_id,
    apiKeyId: key.id,
    entity: 'api_keys',
    entityId: key.id,
    ...auditService.fromRequest(req),
  });
}

/**
 * Valida un plain API key contra DB. Devuelve fila si OK + Application asociada.
 * Lanza HttpError si inválido / revocado / expirado.
 *
 * Side effect: actualiza last_used_at / last_used_ip (best effort, no falla).
 */
async function validateApiKey(plain, { ip } = {}) {
  const hash = sha256(plain);
  const key = await ApiKey.findOne({
    where: { key_hash: hash },
    include: [{ model: Application, as: 'application' }],
  });

  if (!key) throw new HttpError(401, 'InvalidApiKey', 'API key inválida');
  if (key.revoked_at) throw new HttpError(401, 'ApiKeyRevoked', 'API key revocada');
  if (key.expires_at && key.expires_at < new Date()) {
    throw new HttpError(401, 'ApiKeyExpired', 'API key expirada');
  }
  if (!key.application || !key.application.is_active) {
    throw new HttpError(401, 'ApplicationInactive', 'Aplicación inactiva');
  }

  // Touch last_used (no await — best effort)
  ApiKey.update(
    { last_used_at: new Date(), last_used_ip: ip || null },
    { where: { id: key.id } }
  ).catch(() => {});

  return key;
}

module.exports = {
  VALID_SCOPES,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  validateApiKey,
};
