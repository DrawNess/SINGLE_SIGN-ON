'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Role,
  UserRole,
  ClientProfile,
  AdminProfile,
  AuditLog,
  Application,
  RefreshToken,
} = require('../db/models');
const tokenService = require('./token.service');
const auditService = require('./audit.service');
const { HttpError } = require('../middleware/errorHandler');

// ============================================================
// USERS
// ============================================================

/**
 * Lista usuarios paginada con filtros.
 *
 * @param {Object} q  parámetros validados (page, page_size, status, role, q, include_deleted)
 */
async function listUsers(q) {
  const where = {};
  if (q.status) where.status = q.status;
  if (q.q) {
    where.email = { [Op.iLike]: `%${q.q}%` };
  }

  const include = [
    {
      model: ClientProfile,
      as: 'clientProfile',
      attributes: ['first_name', 'last_name', 'phone'],
      required: false,
    },
    {
      model: AdminProfile,
      as: 'adminProfile',
      attributes: ['first_name', 'last_name', 'job_title'],
      required: false,
    },
    {
      model: Role,
      as: 'roles',
      through: { attributes: [] },
      attributes: ['id', 'name'],
      ...(q.role ? { where: { name: q.role }, required: true } : {}),
    },
  ];

  const { rows, count } = await User.findAndCountAll({
    where,
    include,
    paranoid: !q.include_deleted,
    distinct: true,
    order: [['created_at', 'DESC']],
    limit: q.pageSize,
    offset: q.offset,
  });

  return { rows, count };
}

/**
 * Detalle de un usuario con perfiles y roles.
 */
async function getUser(userId) {
  const user = await User.findByPk(userId, {
    paranoid: false,
    include: [
      { model: ClientProfile, as: 'clientProfile' },
      { model: AdminProfile, as: 'adminProfile' },
      {
        model: Role,
        as: 'roles',
        through: { attributes: ['assigned_at', 'assigned_by'] },
      },
    ],
  });
  if (!user) throw new HttpError(404, 'NotFound', 'Usuario no encontrado');
  return user;
}

/**
 * Actualiza status y/o roles de un usuario.
 * Si suspende → revoca todos los refresh tokens activos.
 */
async function updateUser(userId, body, { actorId, actorRoles, req }) {
  const user = await User.findByPk(userId);
  if (!user) throw new HttpError(404, 'NotFound', 'Usuario no encontrado');

  // Bloquear auto-suspensión / auto-borrado del actor
  if (userId === actorId && body.status && body.status !== user.status) {
    throw new HttpError(400, 'BadRequest', 'No puedes cambiar tu propio status');
  }

  const t = await sequelize.transaction();
  const changes = {};

  try {
    if (body.status && body.status !== user.status) {
      changes.status = { from: user.status, to: body.status };
      await user.update({ status: body.status }, { transaction: t });

      if (body.status === 'suspended') {
        await RefreshToken.update(
          { revoked_at: new Date(), revoked_reason: 'admin' },
          { where: { user_id: user.id, revoked_at: null }, transaction: t }
        );
      }
    }

    if (body.roles) {
      const desiredRoles = await Role.findAll({
        where: { name: { [Op.in]: body.roles } },
        transaction: t,
      });
      if (desiredRoles.length !== body.roles.length) {
        throw new HttpError(400, 'BadRequest', 'Algún rol no existe');
      }

      // Verificar permisos: solo super_admin puede asignar admin/super_admin
      const elevatedRoles = body.roles.filter((r) =>
        ['admin', 'super_admin'].includes(r)
      );
      if (
        elevatedRoles.length > 0 &&
        !actorRoles.includes('super_admin')
      ) {
        throw new HttpError(
          403,
          'Forbidden',
          'Solo super_admin puede asignar roles admin/super_admin'
        );
      }

      // Reemplazo total de roles del user
      const currentRoles = await UserRole.findAll({
        where: { user_id: user.id },
        transaction: t,
      });
      const currentRoleIds = currentRoles.map((r) => r.role_id);
      const desiredRoleIds = desiredRoles.map((r) => r.id);

      const toAdd = desiredRoleIds.filter((id) => !currentRoleIds.includes(id));
      const toRemove = currentRoleIds.filter(
        (id) => !desiredRoleIds.includes(id)
      );

      if (toRemove.length > 0) {
        await UserRole.destroy({
          where: { user_id: user.id, role_id: { [Op.in]: toRemove } },
          transaction: t,
        });
      }
      if (toAdd.length > 0) {
        await UserRole.bulkCreate(
          toAdd.map((roleId) => ({
            user_id: user.id,
            role_id: roleId,
            assigned_by: actorId,
            assigned_at: new Date(),
          })),
          { transaction: t }
        );
      }

      changes.roles = { from: currentRoleIds, to: desiredRoleIds };
    }

    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }

  await auditService.log({
    action: 'admin.user.updated',
    userId: user.id,
    actorId,
    actorType: 'admin',
    entity: 'users',
    entityId: user.id,
    metadata: changes,
    ...auditService.fromRequest(req),
  });

  return getUser(user.id);
}

/**
 * Soft delete + revoca tokens.
 */
async function deleteUser(userId, { actorId, req }) {
  const user = await User.findByPk(userId);
  if (!user) throw new HttpError(404, 'NotFound', 'Usuario no encontrado');

  if (userId === actorId) {
    throw new HttpError(400, 'BadRequest', 'No puedes eliminarte a ti mismo');
  }

  const t = await sequelize.transaction();
  try {
    await user.update({ status: 'deleted' }, { transaction: t });
    await user.destroy({ transaction: t }); // paranoid → setea deleted_at
    await RefreshToken.update(
      { revoked_at: new Date(), revoked_reason: 'admin' },
      { where: { user_id: user.id, revoked_at: null }, transaction: t }
    );
    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }

  await auditService.log({
    action: 'admin.user.deleted',
    userId: user.id,
    actorId,
    actorType: 'admin',
    entity: 'users',
    entityId: user.id,
    ...auditService.fromRequest(req),
  });
}

/**
 * Restaura un user soft-deleted.
 */
async function restoreUser(userId, { actorId, req }) {
  const user = await User.findByPk(userId, { paranoid: false });
  if (!user) throw new HttpError(404, 'NotFound', 'Usuario no encontrado');
  if (!user.deleted_at) {
    throw new HttpError(400, 'BadRequest', 'Usuario no está eliminado');
  }

  await user.restore();
  await user.update({ status: 'active' });

  await auditService.log({
    action: 'admin.user.restored',
    userId: user.id,
    actorId,
    actorType: 'admin',
    entity: 'users',
    entityId: user.id,
    ...auditService.fromRequest(req),
  });

  return getUser(user.id);
}

// ============================================================
// AUDIT LOGS
// ============================================================

async function listAuditLogs(q) {
  const where = {};
  if (q.user_id) where.user_id = q.user_id;
  if (q.actor_id) where.actor_id = q.actor_id;
  if (q.action) where.action = q.action;
  if (q.action_prefix) where.action = { [Op.like]: `${q.action_prefix}%` };
  if (q.from || q.to) {
    where.created_at = {};
    if (q.from) where.created_at[Op.gte] = q.from;
    if (q.to) where.created_at[Op.lte] = q.to;
  }

  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: q.pageSize,
    offset: q.offset,
  });

  return { rows, count };
}

// ============================================================
// STATS (dashboard)
// ============================================================

async function getStats() {
  const [
    usersTotal,
    usersActive,
    usersPending,
    usersSuspended,
    rolesTotal,
    applicationsTotal,
    refreshActive,
    auditLast24h,
  ] = await Promise.all([
    User.count(),
    User.count({ where: { status: 'active' } }),
    User.count({ where: { status: 'pending' } }),
    User.count({ where: { status: 'suspended' } }),
    Role.count(),
    Application.count(),
    RefreshToken.count({
      where: { revoked_at: null, expires_at: { [Op.gt]: new Date() } },
    }),
    AuditLog.count({
      where: {
        created_at: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return {
    users: {
      total: usersTotal,
      active: usersActive,
      pending: usersPending,
      suspended: usersSuspended,
    },
    roles: rolesTotal,
    applications: applicationsTotal,
    sessions: {
      active_refresh_tokens: refreshActive,
    },
    audit: {
      events_last_24h: auditLast24h,
    },
  };
}

module.exports = {
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  restoreUser,
  listAuditLogs,
  getStats,
};
