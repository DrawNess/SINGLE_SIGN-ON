'use strict';

const {
  User,
  Role,
  UserRole,
  ClientProfile,
  AdminProfile,
} = require('../db/models');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const auditService = require('../services/audit.service');
const { HttpError } = require('../middleware/errorHandler');
const { Op } = require('sequelize');

/**
 * Devuelve datos públicos de un usuario para consumo s2s.
 * Excluye campos sensibles automáticamente (User.toJSON()).
 */
async function getUserById(req, res, next) {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [
        { model: ClientProfile, as: 'clientProfile' },
        { model: AdminProfile, as: 'adminProfile' },
        {
          model: Role,
          as: 'roles',
          through: { attributes: [] },
          attributes: ['name'],
        },
      ],
    });

    if (!user) throw new HttpError(404, 'NotFound', 'Usuario no encontrado');

    await auditService.log({
      action: 'internal.user.read',
      userId: user.id,
      actorType: 'api_key',
      apiKeyId: req.apiKey.id,
      applicationId: req.application.id,
      entity: 'users',
      entityId: user.id,
      ...auditService.fromRequest(req),
    });

    const payload = user.toJSON();
    if (payload.roles) payload.roles = payload.roles.map((r) => r.name);

    res.json({ user: payload });
  } catch (err) {
    next(err);
  }
}

/**
 * Lista de usuarios paginada. Requiere scope `users:list`.
 */
async function listUsers(req, res, next) {
  try {
    const pag = parsePagination(req.query);
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.email) where.email = req.query.email.toLowerCase();

    const { rows, count } = await User.findAndCountAll({
      where,
      include: [
        { model: ClientProfile, as: 'clientProfile', required: false },
        { model: AdminProfile, as: 'adminProfile', required: false },
        {
          model: Role,
          as: 'roles',
          through: { attributes: [] },
          attributes: ['name'],
        },
      ],
      distinct: true,
      order: [['created_at', 'DESC']],
      limit: pag.limit,
      offset: pag.offset,
    });

    await auditService.log({
      action: 'internal.users.list',
      actorType: 'api_key',
      apiKeyId: req.apiKey.id,
      applicationId: req.application.id,
      metadata: { total: count, filters: req.query },
      ...auditService.fromRequest(req),
    });

    res.json(paginatedResponse({
      rows, count, page: pag.page, pageSize: pag.pageSize,
      mapper: (u) => {
        const v = u.toJSON();
        if (v.roles) v.roles = v.roles.map((r) => r.name);
        return v;
      },
    }));
  } catch (err) {
    next(err);
  }
}

/**
 * Echo / debug endpoint para test API key + scopes.
 * Devuelve info de la api key + app autenticada.
 */
async function whoAmI(req, res) {
  res.json({
    application: {
      id: req.application.id,
      name: req.application.name,
      audience: req.application.audience,
    },
    api_key: {
      id: req.apiKey.id,
      name: req.apiKey.name,
      prefix: req.apiKey.key_prefix,
      scopes: req.apiKey.scopes,
      expires_at: req.apiKey.expires_at,
      last_used_at: req.apiKey.last_used_at,
    },
  });
}

module.exports = { getUserById, listUsers, whoAmI };
