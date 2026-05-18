'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Role,
  UserRole,
  AdminProfile,
  AdminInvitation,
  ClientProfile,
} = require('../db/models');
const { sha256, hashPassword } = require('../utils/hash');
const { randomToken } = require('../utils/random');
const emailService = require('./email.service');
const auditService = require('./audit.service');
const tokenService = require('./token.service');
const config = require('../config/env');
const { HttpError } = require('../middleware/errorHandler');

const ELEVATED_ROLES = ['admin', 'super_admin'];

/**
 * Crea una invitación admin y envía email al destinatario.
 * Solo super_admin puede invitar a admin/super_admin.
 */
async function createInvitation({ email, role, actor, req }) {
  // Verificar rol existe
  const roleRow = await Role.findOne({ where: { name: role } });
  if (!roleRow) throw new HttpError(400, 'BadRequest', `Rol '${role}' no existe`);

  // Solo super_admin puede invitar a admin/super_admin
  if (ELEVATED_ROLES.includes(role) && !actor.roles.includes('super_admin')) {
    throw new HttpError(
      403,
      'Forbidden',
      'Solo super_admin puede invitar a admin/super_admin'
    );
  }

  // Verificar que email no esté ya como user
  const existing = await User.findOne({ where: { email }, paranoid: false });
  if (existing) {
    throw new HttpError(409, 'Conflict', 'Ese email ya tiene cuenta');
  }

  // Invalida invitaciones previas pendientes para mismo email
  await AdminInvitation.update(
    { revoked_at: new Date() },
    {
      where: {
        email,
        accepted_at: null,
        revoked_at: null,
        expires_at: { [Op.gt]: new Date() },
      },
    }
  );

  const plain = randomToken(32);
  const expiresAt = new Date(
    Date.now() + config.security.adminInviteTtlDays * 24 * 60 * 60 * 1000
  );

  const invitation = await AdminInvitation.create({
    email,
    invited_role_id: roleRow.id,
    token_hash: sha256(plain),
    invited_by: actor.userId,
    expires_at: expiresAt,
  });

  // Nombre del inviter para el email
  const inviterName = await getActorName(actor.userId);

  await emailService.sendInvitationEmail({
    to: email,
    inviterName,
    roleName: role,
    token: plain,
  });

  await auditService.log({
    action: 'admin.invitation.created',
    actorId: actor.userId,
    actorType: 'admin',
    entity: 'admin_invitations',
    entityId: invitation.id,
    metadata: { email, role },
    ...auditService.fromRequest(req),
  });

  return invitation;
}

/**
 * Lista invitaciones con filtros.
 */
async function listInvitations(q) {
  const where = {};
  if (q.status === 'pending') {
    where.accepted_at = null;
    where.revoked_at = null;
    where.expires_at = { [Op.gt]: new Date() };
  } else if (q.status === 'accepted') {
    where.accepted_at = { [Op.ne]: null };
  } else if (q.status === 'revoked') {
    where.revoked_at = { [Op.ne]: null };
  } else if (q.status === 'expired') {
    where.accepted_at = null;
    where.revoked_at = null;
    where.expires_at = { [Op.lte]: new Date() };
  }
  if (q.email) where.email = q.email;

  const { rows, count } = await AdminInvitation.findAndCountAll({
    where,
    include: [
      { model: Role, as: 'role', attributes: ['id', 'name'] },
      { model: User, as: 'inviter', attributes: ['id', 'email'] },
    ],
    order: [['created_at', 'DESC']],
    limit: q.pageSize,
    offset: q.offset,
  });

  return { rows, count };
}

/**
 * Revoca una invitación pendiente.
 */
async function revokeInvitation(id, { actor, req }) {
  const inv = await AdminInvitation.findByPk(id);
  if (!inv) throw new HttpError(404, 'NotFound', 'Invitación no encontrada');
  if (inv.accepted_at) {
    throw new HttpError(400, 'BadRequest', 'Invitación ya fue aceptada');
  }
  if (inv.revoked_at) {
    throw new HttpError(400, 'BadRequest', 'Invitación ya fue revocada');
  }

  await inv.update({ revoked_at: new Date() });

  await auditService.log({
    action: 'admin.invitation.revoked',
    actorId: actor.userId,
    actorType: 'admin',
    entity: 'admin_invitations',
    entityId: inv.id,
    metadata: { email: inv.email },
    ...auditService.fromRequest(req),
  });
}

/**
 * Acepta invitación: crea user + admin_profile + asigna rol.
 * Endpoint PÚBLICO (no requiere auth, el token autentica).
 * Devuelve user + tokens (login automático).
 */
async function acceptInvitation({ token, password, firstName, lastName, jobTitle, department, phone, req }) {
  const inv = await AdminInvitation.findOne({
    where: { token_hash: sha256(token) },
    include: [{ model: Role, as: 'role' }],
  });

  if (!inv) throw new HttpError(400, 'InvalidToken', 'Token inválido');
  if (inv.accepted_at) {
    throw new HttpError(400, 'TokenAlreadyUsed', 'Invitación ya fue aceptada');
  }
  if (inv.revoked_at) {
    throw new HttpError(400, 'TokenRevoked', 'Invitación revocada');
  }
  if (inv.expires_at < new Date()) {
    throw new HttpError(400, 'TokenExpired', 'Invitación expirada');
  }

  // Verificar que email NO esté ya como user (race condition)
  const existing = await User.findOne({
    where: { email: inv.email },
    paranoid: false,
  });
  if (existing) {
    throw new HttpError(409, 'Conflict', 'Ya existe una cuenta con ese email');
  }

  const passwordHash = await hashPassword(password);
  const t = await sequelize.transaction();
  let user;
  try {
    user = await User.create(
      {
        email: inv.email,
        password_hash: passwordHash,
        status: 'active',
        email_verified_at: new Date(), // aceptar invitación = verificar email
        password_changed_at: new Date(),
      },
      { transaction: t }
    );

    await AdminProfile.create(
      {
        user_id: user.id,
        first_name: firstName,
        last_name: lastName,
        job_title: jobTitle || null,
        department: department || null,
        phone: phone || null,
      },
      { transaction: t }
    );

    await UserRole.create(
      {
        user_id: user.id,
        role_id: inv.invited_role_id,
        assigned_by: inv.invited_by,
      },
      { transaction: t }
    );

    await inv.update(
      { accepted_at: new Date(), accepted_user_id: user.id },
      { transaction: t }
    );

    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }

  await auditService.log({
    action: 'admin.invitation.accepted',
    userId: user.id,
    actorId: user.id,
    actorType: 'admin',
    entity: 'admin_invitations',
    entityId: inv.id,
    metadata: { role: inv.role.name },
    ...auditService.fromRequest(req),
  });

  return { user, role: inv.role.name };
}

async function getActorName(userId) {
  const ap = await AdminProfile.findOne({ where: { user_id: userId } });
  if (ap) return `${ap.first_name} ${ap.last_name}`.trim();
  const cp = await ClientProfile.findOne({ where: { user_id: userId } });
  if (cp) return `${cp.first_name} ${cp.last_name}`.trim();
  return '';
}

module.exports = {
  createInvitation,
  listInvitations,
  revokeInvitation,
  acceptInvitation,
};
