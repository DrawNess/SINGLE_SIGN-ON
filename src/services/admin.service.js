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

/**
 * Reporte completo del SSO.
 *
 * Query params (opcionales):
 *   from: ISO date — inicio de la ventana. Default: hace 30 dias.
 *   to:   ISO date — fin de la ventana. Default: ahora.
 *
 * Las metricas "_in_range" usan from/to. Las "_total" / "_now" son globales.
 */
async function getStats(query = {}) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = query.from ? new Date(query.from) : defaultFrom;
  const to   = query.to   ? new Date(query.to)   : now;

  const rangeFilter = { [Op.gte]: from, [Op.lte]: to };

  // ── 1. Counts globales de users
  const [
    usersTotal, usersActive, usersPending, usersSuspended, usersDeleted,
    usersVerified, usersWithLoginEver, usersBlockedNow,
    clientsTotal, adminsTotal,
    rolesTotal, applicationsTotal, refreshActive,
  ] = await Promise.all([
    User.count(),
    User.count({ where: { status: 'active' } }),
    User.count({ where: { status: 'pending' } }),
    User.count({ where: { status: 'suspended' } }),
    User.count({ where: { status: 'deleted' }, paranoid: false }),
    User.count({ where: { email_verified_at: { [Op.ne]: null } } }),
    User.count({ where: { last_login_at: { [Op.ne]: null } } }),
    User.count({ where: { locked_until: { [Op.gt]: now } } }),
    ClientProfile.count(),
    AdminProfile.count(),
    Role.count(),
    Application.count(),
    RefreshToken.count({ where: { revoked_at: null, expires_at: { [Op.gt]: now } } }),
  ]);

  // ── 2. Counts en el rango (from..to)
  const [
    registeredInRange,
    loginsSuccessInRange, loginsFailedInRange,
    resetsRequestedInRange, resetsCompletedInRange,
    tokenTheftsInRange,
  ] = await Promise.all([
    User.count({ where: { created_at: rangeFilter } }),
    AuditLog.count({ where: { action: 'auth.login.success', created_at: rangeFilter } }),
    AuditLog.count({ where: { action: 'auth.login.failed',  created_at: rangeFilter } }),
    AuditLog.count({ where: { action: 'auth.password.reset_requested', created_at: rangeFilter } }),
    AuditLog.count({ where: { action: 'auth.password.reset_completed', created_at: rangeFilter } }),
    AuditLog.count({ where: { action: 'auth.token.theft_detected', created_at: rangeFilter } }),
  ]);

  // ── 3. Profile completeness (solo clientes)
  const [completeness] = await sequelize.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone NOT LIKE '+591000%')::int AS with_phone,
      COUNT(*) FILTER (WHERE document_type IS NOT NULL AND document_number IS NOT NULL)::int AS with_document,
      COUNT(*) FILTER (WHERE ciudad IS NOT NULL AND calle_avenida IS NOT NULL)::int AS with_address,
      COUNT(*) FILTER (WHERE birth_date IS NOT NULL)::int AS with_birth_date,
      COUNT(*) FILTER (WHERE
        document_type IS NOT NULL
        AND document_number IS NOT NULL
        AND ciudad IS NOT NULL
        AND calle_avenida IS NOT NULL
        AND birth_date IS NOT NULL
      )::int AS fully_completed
    FROM client_profiles
  `, { type: sequelize.QueryTypes.SELECT });

  // ── 4. Login failure reasons (en rango)
  const failureReasons = await sequelize.query(`
    SELECT metadata->>'reason' AS reason, COUNT(*)::int AS count
    FROM audit_logs
    WHERE action = 'auth.login.failed'
      AND created_at >= :from AND created_at <= :to
    GROUP BY reason
    ORDER BY count DESC
  `, {
    replacements: { from, to },
    type: sequelize.QueryTypes.SELECT,
  });

  // ── 5. Top 10 IPs con fallos
  const topFailureIps = await sequelize.query(`
    SELECT ip::text AS ip, COUNT(*)::int AS attempts
    FROM audit_logs
    WHERE action = 'auth.login.failed'
      AND ip IS NOT NULL
      AND created_at >= :from AND created_at <= :to
    GROUP BY ip
    ORDER BY attempts DESC
    LIMIT 10
  `, {
    replacements: { from, to },
    type: sequelize.QueryTypes.SELECT,
  });

  // ── 6. Time series por dia (registros + logins)
  const registrationsPerDay = await sequelize.query(`
    SELECT DATE(created_at) AS date, COUNT(*)::int AS count
    FROM users
    WHERE created_at >= :from AND created_at <= :to
    GROUP BY date
    ORDER BY date
  `, {
    replacements: { from, to },
    type: sequelize.QueryTypes.SELECT,
  });

  const loginsPerDay = await sequelize.query(`
    SELECT DATE(created_at) AS date,
      COUNT(*) FILTER (WHERE action='auth.login.success')::int AS success,
      COUNT(*) FILTER (WHERE action='auth.login.failed')::int  AS failed
    FROM audit_logs
    WHERE action IN ('auth.login.success', 'auth.login.failed')
      AND created_at >= :from AND created_at <= :to
    GROUP BY date
    ORDER BY date
  `, {
    replacements: { from, to },
    type: sequelize.QueryTypes.SELECT,
  });

  // ── 7. Geografia (top ciudades de clientes)
  const byCity = await sequelize.query(`
    SELECT COALESCE(ciudad, '(sin dato)') AS city, COUNT(*)::int AS count
    FROM client_profiles
    GROUP BY ciudad
    ORDER BY count DESC
    LIMIT 15
  `, { type: sequelize.QueryTypes.SELECT });

  const byDepartamento = await sequelize.query(`
    SELECT COALESCE(departamento, '(sin dato)') AS departamento, COUNT(*)::int AS count
    FROM client_profiles
    GROUP BY departamento
    ORDER BY count DESC
  `, { type: sequelize.QueryTypes.SELECT });

  // ── 8. Demografia (rango edades, solo si birth_date presente)
  const ageDistribution = await sequelize.query(`
    SELECT
      CASE
        WHEN birth_date IS NULL THEN '(sin dato)'
        WHEN EXTRACT(YEAR FROM AGE(birth_date)) < 18 THEN '<18'
        WHEN EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN 18 AND 24 THEN '18-24'
        WHEN EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN 25 AND 34 THEN '25-34'
        WHEN EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN 35 AND 44 THEN '35-44'
        WHEN EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN 45 AND 54 THEN '45-54'
        ELSE '55+'
      END AS age_group,
      COUNT(*)::int AS count
    FROM client_profiles
    GROUP BY age_group
    ORDER BY age_group
  `, { type: sequelize.QueryTypes.SELECT });

  // ── 9. Onboarding: tiempo desde registro hasta primer login (mediana, p90)
  const onboarding = await sequelize.query(`
    SELECT
      COUNT(*)::int AS total_logueados,
      ROUND(EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY (last_login_at - created_at))) / 3600, 2)::float AS p50_horas,
      ROUND(EXTRACT(EPOCH FROM percentile_cont(0.9) WITHIN GROUP (ORDER BY (last_login_at - created_at))) / 3600, 2)::float AS p90_horas
    FROM users
    WHERE last_login_at IS NOT NULL
  `, { type: sequelize.QueryTypes.SELECT });

  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    generated_at: new Date().toISOString(),
    users: {
      total: usersTotal,
      clients: clientsTotal,
      admins:  adminsTotal,
      by_status: {
        active:    usersActive,
        pending:   usersPending,
        suspended: usersSuspended,
        deleted:   usersDeleted,
      },
      verified:        usersVerified,
      verified_pct:    pct(usersVerified, usersTotal),
      with_login_ever: usersWithLoginEver,
      with_login_pct:  pct(usersWithLoginEver, usersTotal),
      blocked_now:     usersBlockedNow,
      registered_in_range: registeredInRange,
    },
    profile_completeness: {
      total_clients:   completeness.total,
      with_phone:      completeness.with_phone,
      with_phone_pct:  pct(completeness.with_phone, completeness.total),
      with_document:   completeness.with_document,
      with_document_pct: pct(completeness.with_document, completeness.total),
      with_address:    completeness.with_address,
      with_address_pct: pct(completeness.with_address, completeness.total),
      with_birth_date: completeness.with_birth_date,
      fully_completed: completeness.fully_completed,
      fully_completed_pct: pct(completeness.fully_completed, completeness.total),
    },
    auth: {
      logins_success_in_range: loginsSuccessInRange,
      logins_failed_in_range:  loginsFailedInRange,
      failure_rate_pct:        pct(loginsFailedInRange, loginsSuccessInRange + loginsFailedInRange),
      failure_reasons:         failureReasons.reduce((a, r) => { a[r.reason || '(unknown)'] = r.count; return a; }, {}),
      password_resets_requested: resetsRequestedInRange,
      password_resets_completed: resetsCompletedInRange,
      reset_completion_pct:    pct(resetsCompletedInRange, resetsRequestedInRange),
      token_theft_detected:    tokenTheftsInRange,
    },
    sessions: {
      active_refresh_tokens: refreshActive,
    },
    top_failure_ips: topFailureIps,
    time_series: {
      registrations_per_day: registrationsPerDay,
      logins_per_day:        loginsPerDay,
    },
    geography: {
      by_city:         byCity,
      by_departamento: byDepartamento,
    },
    demographics: {
      by_age_group: ageDistribution,
    },
    onboarding: onboarding[0] || null,
    meta: {
      roles_count: rolesTotal,
      applications_count: applicationsTotal,
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
