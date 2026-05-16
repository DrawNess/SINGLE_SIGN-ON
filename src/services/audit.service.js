'use strict';

const { AuditLog } = require('../db/models');

/**
 * Registra un evento de auditoría.
 * Falla silenciosamente si hay error (audit no debe romper flujo).
 *
 * Ejemplo:
 *   await audit.log({
 *     action: 'auth.login.success',
 *     userId: '...',
 *     actorId: '...',
 *     actorType: 'user',
 *     ip: req.ip,
 *     userAgent: req.get('user-agent'),
 *     metadata: { applicationId: '...' },
 *   });
 */
async function log({
  action,
  userId = null,
  actorId = null,
  actorType,
  apiKeyId = null,
  applicationId = null,
  entity = null,
  entityId = null,
  metadata = null,
  ip = null,
  userAgent = null,
}) {
  try {
    await AuditLog.create({
      action,
      user_id: userId,
      actor_id: actorId,
      actor_type: actorType,
      api_key_id: apiKeyId,
      application_id: applicationId,
      entity,
      entity_id: entityId,
      metadata,
      ip,
      user_agent: userAgent,
    });
  } catch (err) {
    console.error('[audit] fallo al registrar:', err.message);
  }
}

/**
 * Extrae IP y user-agent del request Express.
 */
function fromRequest(req) {
  return {
    ip: req.ip || null,
    userAgent: req.get('user-agent') || null,
  };
}

module.exports = { log, fromRequest };
