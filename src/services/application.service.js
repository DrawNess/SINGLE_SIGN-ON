'use strict';

const { Op } = require('sequelize');
const { Application } = require('../db/models');
const { hashPassword } = require('../utils/hash');
const { randomToken } = require('../utils/random');
const auditService = require('./audit.service');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Crea una application.
 * Si tipo != spa-web → genera client_secret aleatorio + lo hashea con Argon2id.
 * Devuelve { application, client_secret } — secret SOLO se muestra UNA VEZ.
 */
async function createApplication(input, { actorId, req }) {
  // Verificar unicidad
  const dupName = await Application.findOne({ where: { name: input.name } });
  if (dupName) throw new HttpError(409, 'Conflict', 'name ya está en uso');

  const dupClientId = await Application.findOne({
    where: { client_id: input.client_id },
  });
  if (dupClientId) throw new HttpError(409, 'Conflict', 'client_id ya está en uso');

  let clientSecretPlain = null;
  let clientSecretHash = null;

  if (input.type !== 'spa-web') {
    clientSecretPlain = randomToken(48);
    clientSecretHash = await hashPassword(clientSecretPlain);
  }

  const app = await Application.create({
    name: input.name,
    display_name: input.display_name,
    client_id: input.client_id,
    client_secret_hash: clientSecretHash,
    type: input.type,
    audience: input.audience,
    allowed_origins: input.allowed_origins || [],
    allowed_redirect_uris: input.allowed_redirect_uris || [],
    is_active: input.is_active !== false,
    created_by: actorId,
  });

  await auditService.log({
    action: 'admin.application.created',
    actorId,
    actorType: 'admin',
    applicationId: app.id,
    entity: 'applications',
    entityId: app.id,
    metadata: { name: app.name, type: app.type, audience: app.audience },
    ...auditService.fromRequest(req),
  });

  return { application: app, client_secret: clientSecretPlain };
}

async function listApplications(q) {
  const where = {};
  if (q.is_active !== undefined) where.is_active = q.is_active;
  if (q.type) where.type = q.type;
  if (q.q) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${q.q}%` } },
      { display_name: { [Op.iLike]: `%${q.q}%` } },
      { client_id: { [Op.iLike]: `%${q.q}%` } },
    ];
  }

  const { rows, count } = await Application.findAndCountAll({
    where,
    paranoid: !q.include_deleted,
    order: [['created_at', 'DESC']],
    limit: q.pageSize,
    offset: q.offset,
  });

  return { rows, count };
}

async function getApplication(id) {
  const app = await Application.findByPk(id, { paranoid: false });
  if (!app) throw new HttpError(404, 'NotFound', 'Application no encontrada');
  return app;
}

/**
 * Actualiza campos no-sensibles. Para rotar client_secret hay endpoint aparte.
 */
async function updateApplication(id, body, { actorId, req }) {
  const app = await Application.findByPk(id);
  if (!app) throw new HttpError(404, 'NotFound', 'Application no encontrada');

  const allowed = [
    'display_name',
    'audience',
    'allowed_origins',
    'allowed_redirect_uris',
    'is_active',
  ];
  const updates = {};
  const changes = {};
  for (const key of allowed) {
    if (body[key] !== undefined && JSON.stringify(body[key]) !== JSON.stringify(app[key])) {
      changes[key] = { from: app[key], to: body[key] };
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return app;
  }

  await app.update(updates);

  await auditService.log({
    action: 'admin.application.updated',
    actorId,
    actorType: 'admin',
    applicationId: app.id,
    entity: 'applications',
    entityId: app.id,
    metadata: changes,
    ...auditService.fromRequest(req),
  });

  return app;
}

async function deleteApplication(id, { actorId, req }) {
  const app = await Application.findByPk(id);
  if (!app) throw new HttpError(404, 'NotFound', 'Application no encontrada');
  await app.destroy(); // paranoid → soft delete

  await auditService.log({
    action: 'admin.application.deleted',
    actorId,
    actorType: 'admin',
    applicationId: app.id,
    entity: 'applications',
    entityId: app.id,
    ...auditService.fromRequest(req),
  });
}

/**
 * Rota client_secret. Devuelve el nuevo plano UNA VEZ.
 * Solo aplicable a apps con tipo != spa-web.
 */
async function rotateClientSecret(id, { actorId, req }) {
  const app = await Application.findByPk(id);
  if (!app) throw new HttpError(404, 'NotFound', 'Application no encontrada');
  if (app.type === 'spa-web') {
    throw new HttpError(
      400,
      'BadRequest',
      'Apps tipo spa-web no usan client_secret'
    );
  }

  const newSecret = randomToken(48);
  const newHash = await hashPassword(newSecret);
  await app.update({ client_secret_hash: newHash });

  await auditService.log({
    action: 'admin.application.secret_rotated',
    actorId,
    actorType: 'admin',
    applicationId: app.id,
    entity: 'applications',
    entityId: app.id,
    ...auditService.fromRequest(req),
  });

  return { application: app, client_secret: newSecret };
}

module.exports = {
  createApplication,
  listApplications,
  getApplication,
  updateApplication,
  deleteApplication,
  rotateClientSecret,
};
