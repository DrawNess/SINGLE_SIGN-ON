'use strict';

const { Op } = require('sequelize');
const { RefreshToken, Application } = require('../db/models');
const auditService = require('./audit.service');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Lista sesiones (refresh tokens) activas de un usuario.
 * Por default solo NO revocados, no expirados. Filtro `include_revoked=true` muestra todos.
 */
async function listUserSessions(userId, q) {
  const where = { user_id: userId };
  if (!q.include_revoked) {
    where.revoked_at = null;
    where.expires_at = { [Op.gt]: new Date() };
  }

  const { rows, count } = await RefreshToken.findAndCountAll({
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

/**
 * Revoca una sesión específica (force-logout de un dispositivo).
 */
async function revokeSession(sessionId, { actor, req }) {
  const session = await RefreshToken.findByPk(sessionId);
  if (!session) throw new HttpError(404, 'NotFound', 'Sesión no encontrada');
  if (session.revoked_at) {
    throw new HttpError(400, 'BadRequest', 'Sesión ya estaba revocada');
  }

  await session.update({ revoked_at: new Date(), revoked_reason: 'admin' });

  await auditService.log({
    action: 'admin.session.revoked',
    userId: session.user_id,
    actorId: actor.userId,
    actorType: 'admin',
    entity: 'refresh_tokens',
    entityId: session.id,
    ...auditService.fromRequest(req),
  });
}

/**
 * Revoca todas las sesiones activas de un usuario (force-logout todos los devices).
 */
async function revokeAllForUser(userId, { actor, req }) {
  const [affected] = await RefreshToken.update(
    { revoked_at: new Date(), revoked_reason: 'admin' },
    { where: { user_id: userId, revoked_at: null } }
  );

  await auditService.log({
    action: 'admin.sessions.revoked_all',
    userId,
    actorId: actor.userId,
    actorType: 'admin',
    metadata: { count: affected },
    ...auditService.fromRequest(req),
  });

  return { revoked: affected };
}

module.exports = {
  listUserSessions,
  revokeSession,
  revokeAllForUser,
};
