'use strict';

const { Op } = require('sequelize');
const {
  User,
  Role,
  ClientProfile,
  AdminProfile,
  RefreshToken,
  Application,
} = require('../db/models');
const auditService = require('./audit.service');
const { HttpError } = require('../middleware/errorHandler');

// Campos que el user puede editar de su client_profile
const CLIENT_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'birth_date',
  'document_type',
  'document_number',
  'razon_social',
  'departamento',
  'provincia',
  'ciudad',
  'calle_avenida',
  'numero',
  'casa_dpto',
  'link_google_maps',
];

// Campos que el user puede editar de su admin_profile
const ADMIN_FIELDS = [
  'first_name',
  'last_name',
  'job_title',
  'department',
  'phone',
];

/**
 * Carga user + roles + profile actual. Usado para `GET /auth/me`.
 */
async function getMe(userId) {
  const user = await User.findByPk(userId, {
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
  const roles = (user.roles || []).map((r) => r.name);
  return { user, roles };
}

/**
 * Actualiza el profile (client o admin) del user autenticado.
 * Detecta automáticamente qué profile aplica.
 */
async function updateMyProfile(userId, body, { req }) {
  const user = await User.findByPk(userId);
  if (!user) throw new HttpError(404, 'NotFound', 'Usuario no encontrado');

  const clientProfile = await ClientProfile.findOne({ where: { user_id: userId } });
  const adminProfile = await AdminProfile.findOne({ where: { user_id: userId } });

  let profile;
  let allowedFields;
  let profileType;
  if (clientProfile) {
    profile = clientProfile;
    allowedFields = CLIENT_FIELDS;
    profileType = 'client';
  } else if (adminProfile) {
    profile = adminProfile;
    allowedFields = ADMIN_FIELDS;
    profileType = 'admin';
  } else {
    throw new HttpError(404, 'NotFound', 'No tienes profile configurado');
  }

  // Validaciones específicas por tipo de profile
  if (profileType === 'client' && body.phone !== undefined) {
    if (!/^\+591[0-9]{8}$/.test(body.phone)) {
      throw new HttpError(
        400,
        'ValidationError',
        'Teléfono debe tener formato +591######## (Bolivia)'
      );
    }
    // Phone UNIQUE — verificar no esté tomado por otro
    const conflict = await ClientProfile.findOne({
      where: { phone: body.phone, user_id: { [Op.ne]: userId } },
    });
    if (conflict) {
      throw new HttpError(409, 'PhoneInUse', 'Teléfono ya está en uso');
    }
  }

  // Si se envía document_number, validar unicidad (no en uso por otro user)
  if (profileType === 'client' && body.document_number) {
    const conflictDoc = await ClientProfile.findOne({
      where: {
        document_number: body.document_number,
        user_id: { [Op.ne]: userId },
      },
    });
    if (conflictDoc) {
      throw new HttpError(409, 'DocumentInUse', 'Número de documento ya está en uso');
    }
  }

  // Filtrar solo campos permitidos + detectar cambios reales
  const updates = {};
  const changes = {};
  for (const key of allowedFields) {
    if (body[key] !== undefined && body[key] !== profile[key]) {
      updates[key] = body[key];
      changes[key] = { from: profile[key], to: body[key] };
    }
  }

  // Validar regla NIT → razon_social
  if (profileType === 'client') {
    const finalDocType = updates.document_type ?? profile.document_type;
    const finalRazon = updates.razon_social !== undefined
      ? updates.razon_social
      : profile.razon_social;
    if (finalDocType === 'NIT' && !finalRazon) {
      throw new HttpError(
        400,
        'BadRequest',
        'razon_social es obligatorio cuando document_type es NIT'
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return { user, profile, profileType, roles: await getRoleNames(userId) };
  }

  await profile.update(updates);

  await auditService.log({
    action: 'user.profile.updated',
    userId: user.id,
    actorId: user.id,
    actorType: 'user',
    entity: profileType === 'client' ? 'client_profiles' : 'admin_profiles',
    entityId: user.id,
    metadata: { fields: Object.keys(changes), changes },
    ...auditService.fromRequest(req),
  });

  return { user, profile, profileType, roles: await getRoleNames(userId) };
}

/**
 * Lista las sesiones activas del user (refresh tokens no revocados/expirados).
 * Marca cuál es la sesión actual usando `sid` del JWT.
 */
async function listMySessions(userId, currentSid) {
  const sessions = await RefreshToken.findAll({
    where: {
      user_id: userId,
      revoked_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
    include: [
      {
        model: Application,
        as: 'application',
        attributes: ['id', 'name', 'display_name', 'type'],
      },
    ],
    order: [['created_at', 'DESC']],
  });

  return sessions.map((s) => {
    const v = s.toJSON();
    v.is_current = s.id === currentSid;
    return v;
  });
}

/**
 * Revoca una sesión específica del user actual.
 * Service verifica que la sesión pertenezca al user (anti-IDOR).
 */
async function revokeMySession(userId, sessionId, { req }) {
  const session = await RefreshToken.findOne({
    where: { id: sessionId, user_id: userId },
  });
  if (!session) {
    throw new HttpError(404, 'NotFound', 'Sesión no encontrada');
  }
  if (session.revoked_at) {
    throw new HttpError(400, 'BadRequest', 'Sesión ya estaba revocada');
  }

  await session.update({ revoked_at: new Date(), revoked_reason: 'logout' });

  await auditService.log({
    action: 'auth.session.revoked_self',
    userId,
    actorId: userId,
    actorType: 'user',
    entity: 'refresh_tokens',
    entityId: session.id,
    ...auditService.fromRequest(req),
  });
}

/**
 * Revoca TODAS las sesiones del user excepto la actual (basada en `sid` del JWT).
 * Útil para "cerrar todas las demás sesiones".
 */
async function logoutOthers(userId, currentSid, { req }) {
  const where = {
    user_id: userId,
    revoked_at: null,
  };
  if (currentSid) {
    where.id = { [Op.ne]: currentSid };
  }

  const [affected] = await RefreshToken.update(
    { revoked_at: new Date(), revoked_reason: 'logout' },
    { where }
  );

  await auditService.log({
    action: 'auth.session.logout_others',
    userId,
    actorId: userId,
    actorType: 'user',
    metadata: { revoked: affected, kept: currentSid },
    ...auditService.fromRequest(req),
  });

  return { revoked: affected };
}

async function getRoleNames(userId) {
  const rows = await Role.findAll({
    include: [
      {
        association: 'userRoles',
        where: { user_id: userId },
        attributes: [],
        required: true,
      },
    ],
    attributes: ['name'],
  });
  return rows.map((r) => r.name);
}

module.exports = {
  getMe,
  updateMyProfile,
  listMySessions,
  revokeMySession,
  logoutOthers,
};
