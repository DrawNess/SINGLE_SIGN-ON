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
 * Reporte completo del SSO (dashboard admin).
 *
 * Query params (opcionales):
 *   from:     ISO date — inicio de la ventana (inclusive). Default: hace 30 días.
 *   to:       ISO date — fin de la ventana (EXCLUSIVO, semiabierto). Default: ahora.
 *   timezone: zona horaria IANA para agrupaciones por día. Default: America/La_Paz.
 *   compare:  'previous' o 'none'. Default 'previous'.
 *             Si 'previous' incluye comparación con el periodo anterior de igual longitud.
 *
 * Convención: rangos semiabiertos [from, to). Es decir, eventos con
 * created_at == to NO se incluyen. Esto evita ambigüedad con fines de día.
 *
 * Definiciones precisas:
 *   users.total                      → users (sin deleted) — usuarios usables hoy
 *   users.total_including_deleted    → users con paranoid:false — métricas de auditoría
 *   users.clients / admins           → count de profile rows (puede haber pequeños
 *                                       descalces con users si hay perfiles huérfanos)
 *   onboarding                       → primer auth.login.success (NO último login)
 */
async function getStats(query = {}) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = query.from ? new Date(query.from) : defaultFrom;
  const to   = query.to   ? new Date(query.to)   : now;
  const tz   = query.timezone || 'America/La_Paz';
  const compareEnabled = (query.compare ?? 'previous') !== 'none';

  // Periodo anterior con misma longitud (semiabierto)
  const periodMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - periodMs);
  const prevTo   = new Date(from.getTime());

  // ── Helpers SQL: rango semiabierto [from, to)
  const inRangeAudit = (action) =>
    AuditLog.count({
      where: { action, created_at: { [Op.gte]: from, [Op.lt]: to } },
    });
  const inRangePrevAudit = (action) =>
    AuditLog.count({
      where: { action, created_at: { [Op.gte]: prevFrom, [Op.lt]: prevTo } },
    });

  // ── TODAS las queries en paralelo
  const [
    // Globales users
    usersTotalActive, usersIncludingDeleted,
    usersActive, usersPending, usersSuspended, usersDeleted,
    usersVerified, usersWithLoginEver, usersBlockedNow,
    clientsTotal, adminsTotal,
    rolesTotal, applicationsTotal, refreshActive,

    // En rango (semiabierto)
    registeredInRange,
    loginsSuccessInRange, loginsFailedInRange,
    resetsRequestedInRange, resetsCompletedInRange,
    tokenTheftsInRange,

    // Periodo anterior (semiabierto) — para comparación
    prevRegistered,
    prevLoginsSuccess, prevLoginsFailed,
    prevResetsRequested,

    // Queries crudas (devuelven arrays)
    completenessRows,
    dataQualityRows,
    failureReasonsRows,
    topFailureIpsRows,
    registrationsPerDayRows,
    loginsPerDayRows,
    byCityRows,
    byDepartamentoRows,
    ageDistributionRows,
    onboardingRows,
    uniqueLoggedInRows,
    byApplicationRows,
  ] = await Promise.all([
    User.count(),                                                        // paranoid:true (excluye deleted)
    User.count({ paranoid: false }),
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

    User.count({ where: { created_at: { [Op.gte]: from, [Op.lt]: to } } }),
    inRangeAudit('auth.login.success'),
    inRangeAudit('auth.login.failed'),
    inRangeAudit('auth.password.reset_requested'),
    inRangeAudit('auth.password.reset_completed'),
    inRangeAudit('auth.token.theft_detected'),

    compareEnabled
      ? User.count({ where: { created_at: { [Op.gte]: prevFrom, [Op.lt]: prevTo } } })
      : Promise.resolve(null),
    compareEnabled ? inRangePrevAudit('auth.login.success') : Promise.resolve(null),
    compareEnabled ? inRangePrevAudit('auth.login.failed')  : Promise.resolve(null),
    compareEnabled ? inRangePrevAudit('auth.password.reset_requested') : Promise.resolve(null),

    // ─ Profile completeness
    sequelize.query(`
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
    `, { type: sequelize.QueryTypes.SELECT }),

    // ─ Data quality (placeholder phones, etc)
    sequelize.query(`
      SELECT
        COUNT(*) FILTER (WHERE phone LIKE '+591000%' OR phone IS NULL)::int AS placeholder_or_missing_phone,
        COUNT(*) FILTER (WHERE document_number IS NULL)::int AS missing_document,
        COUNT(*) FILTER (WHERE ciudad IS NULL OR calle_avenida IS NULL)::int AS incomplete_address
      FROM client_profiles
    `, { type: sequelize.QueryTypes.SELECT }),

    // ─ Login failure reasons (en rango semiabierto)
    sequelize.query(`
      SELECT metadata->>'reason' AS reason, COUNT(*)::int AS count
      FROM audit_logs
      WHERE action = 'auth.login.failed'
        AND created_at >= :from AND created_at < :to
      GROUP BY reason
      ORDER BY count DESC
    `, { replacements: { from, to }, type: sequelize.QueryTypes.SELECT }),

    // ─ Top IPs (en rango)
    sequelize.query(`
      SELECT ip::text AS ip, COUNT(*)::int AS attempts
      FROM audit_logs
      WHERE action = 'auth.login.failed'
        AND ip IS NOT NULL
        AND created_at >= :from AND created_at < :to
      GROUP BY ip
      ORDER BY attempts DESC
      LIMIT 10
    `, { replacements: { from, to }, type: sequelize.QueryTypes.SELECT }),

    // ─ Registrations per day (timezone-aware)
    sequelize.query(`
      SELECT (created_at AT TIME ZONE :tz)::date AS date, COUNT(*)::int AS count
      FROM users
      WHERE created_at >= :from AND created_at < :to
      GROUP BY date
      ORDER BY date
    `, { replacements: { from, to, tz }, type: sequelize.QueryTypes.SELECT }),

    // ─ Logins per day (timezone-aware)
    sequelize.query(`
      SELECT (created_at AT TIME ZONE :tz)::date AS date,
        COUNT(*) FILTER (WHERE action='auth.login.success')::int AS success,
        COUNT(*) FILTER (WHERE action='auth.login.failed')::int  AS failed
      FROM audit_logs
      WHERE action IN ('auth.login.success', 'auth.login.failed')
        AND created_at >= :from AND created_at < :to
      GROUP BY date
      ORDER BY date
    `, { replacements: { from, to, tz }, type: sequelize.QueryTypes.SELECT }),

    // ─ Por ciudad (global)
    sequelize.query(`
      SELECT COALESCE(ciudad, '(sin dato)') AS city, COUNT(*)::int AS count
      FROM client_profiles
      GROUP BY ciudad
      ORDER BY count DESC
      LIMIT 15
    `, { type: sequelize.QueryTypes.SELECT }),

    // ─ Por departamento
    sequelize.query(`
      SELECT COALESCE(departamento::text, '(sin dato)') AS departamento, COUNT(*)::int AS count
      FROM client_profiles
      GROUP BY departamento
      ORDER BY count DESC
    `, { type: sequelize.QueryTypes.SELECT }),

    // ─ Edad
    sequelize.query(`
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
    `, { type: sequelize.QueryTypes.SELECT }),

    // ─ Onboarding: tiempo desde registro hasta PRIMER login (audit_logs)
    sequelize.query(`
      WITH first_logins AS (
        SELECT user_id, MIN(created_at) AS first_login_at
        FROM audit_logs
        WHERE action = 'auth.login.success'
          AND user_id IS NOT NULL
        GROUP BY user_id
      )
      SELECT
        COUNT(*)::int AS total_logueados,
        COALESCE(ROUND(EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY (fl.first_login_at - u.created_at))) / 3600, 2), 0)::float AS p50_horas,
        COALESCE(ROUND(EXTRACT(EPOCH FROM percentile_cont(0.9) WITHIN GROUP (ORDER BY (fl.first_login_at - u.created_at))) / 3600, 2), 0)::float AS p90_horas
      FROM users u
      JOIN first_logins fl ON fl.user_id = u.id
    `, { type: sequelize.QueryTypes.SELECT }),

    // ─ Usuarios únicos que loguearon en el rango
    sequelize.query(`
      SELECT COUNT(DISTINCT user_id)::int AS unique_users
      FROM audit_logs
      WHERE action = 'auth.login.success'
        AND user_id IS NOT NULL
        AND created_at >= :from AND created_at < :to
    `, { replacements: { from, to }, type: sequelize.QueryTypes.SELECT }),

    // ─ Logins por aplicación (en rango)
    sequelize.query(`
      SELECT COALESCE(a.name, '(sin app)') AS app_name,
             COUNT(*)::int AS count
      FROM audit_logs al
      LEFT JOIN applications a ON a.id = al.application_id
      WHERE al.action = 'auth.login.success'
        AND al.created_at >= :from AND al.created_at < :to
      GROUP BY a.name
      ORDER BY count DESC
    `, { replacements: { from, to }, type: sequelize.QueryTypes.SELECT }),
  ]);

  const completeness = completenessRows[0];
  const dataQuality  = dataQualityRows[0];
  const onboarding   = onboardingRows[0];
  const uniqueLoggedIn = uniqueLoggedInRows[0]?.unique_users ?? 0;

  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const delta = (curr, prev) => {
    if (prev === null || prev === undefined) return null;
    if (prev === 0)  return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 1000) / 10;
  };

  return {
    range: {
      from: from.toISOString(),
      to:   to.toISOString(),
      timezone: tz,
      semi_open: true,                         // [from, to)
      previous: compareEnabled
        ? { from: prevFrom.toISOString(), to: prevTo.toISOString() }
        : null,
    },
    generated_at: new Date().toISOString(),

    users: {
      total:                    usersTotalActive,              // utilizables (excluye deleted)
      total_including_deleted:  usersIncludingDeleted,         // auditoría
      clients:                  clientsTotal,                  // # client_profiles
      admins:                   adminsTotal,                   // # admin_profiles
      by_status: {
        active:    usersActive,
        pending:   usersPending,
        suspended: usersSuspended,
        deleted:   usersDeleted,
      },
      verified:        usersVerified,
      verified_pct:    pct(usersVerified, usersTotalActive),
      with_login_ever: usersWithLoginEver,
      with_login_pct:  pct(usersWithLoginEver, usersTotalActive),
      blocked_now:     usersBlockedNow,
      registered_in_range: registeredInRange,
      registered_in_range_delta_pct: delta(registeredInRange, prevRegistered),
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

    data_quality: {
      placeholder_or_missing_phone: dataQuality.placeholder_or_missing_phone,
      missing_document:             dataQuality.missing_document,
      incomplete_address:           dataQuality.incomplete_address,
    },

    auth: {
      logins_success_in_range: loginsSuccessInRange,
      logins_success_delta_pct: delta(loginsSuccessInRange, prevLoginsSuccess),
      logins_failed_in_range:  loginsFailedInRange,
      logins_failed_delta_pct: delta(loginsFailedInRange, prevLoginsFailed),
      unique_users_logged_in_in_range: uniqueLoggedIn,
      failure_rate_pct:        pct(loginsFailedInRange, loginsSuccessInRange + loginsFailedInRange),
      failure_reasons:         failureReasonsRows.reduce((a, r) => { a[r.reason || '(unknown)'] = r.count; return a; }, {}),
      password_resets_requested: resetsRequestedInRange,
      password_resets_requested_delta_pct: delta(resetsRequestedInRange, prevResetsRequested),
      password_resets_completed: resetsCompletedInRange,
      // NOTA: este % puede ser engañoso si un reset solicitado fuera del rango se completó dentro.
      // Es ratio puro de eventos en el rango, no cohort tracking real.
      reset_completion_pct:    pct(resetsCompletedInRange, resetsRequestedInRange),
      token_theft_detected:    tokenTheftsInRange,
      by_application:          byApplicationRows,
    },

    sessions: {
      active_refresh_tokens: refreshActive,
    },

    top_failure_ips: topFailureIpsRows,

    time_series: {
      registrations_per_day: registrationsPerDayRows,
      logins_per_day:        loginsPerDayRows,
    },

    geography: {
      by_city:         byCityRows,
      by_departamento: byDepartamentoRows,
    },
    demographics: {
      by_age_group: ageDistributionRows,
    },
    onboarding: onboarding || null,
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
