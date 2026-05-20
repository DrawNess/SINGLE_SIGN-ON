'use strict';

const adminService = require('../services/admin.service');
const applicationService = require('../services/application.service');
const invitationService = require('../services/invitation.service');
const sessionService = require('../services/session.service');
const apiKeyService = require('../services/apiKey.service');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

function userToJson(user) {
  const v = user.toJSON();
  if (v.roles) v.roles = v.roles.map((r) => (typeof r === 'string' ? r : r.name));
  return v;
}

// ============================================================
// USERS
// ============================================================

async function listUsers(req, res, next) {
  try {
    const pag = parsePagination(req.query);
    const { rows, count } = await adminService.listUsers({ ...req.query, ...pag });
    res.json(paginatedResponse({ rows, count, page: pag.page, pageSize: pag.pageSize, mapper: userToJson }));
  } catch (err) { next(err); }
}

async function getUser(req, res, next) {
  try {
    const user = await adminService.getUser(req.params.id);
    res.json({ user: userToJson(user) });
  } catch (err) { next(err); }
}

async function updateUser(req, res, next) {
  try {
    const user = await adminService.updateUser(req.params.id, req.body, {
      actorId: req.auth.userId,
      actorRoles: req.auth.roles,
      req,
    });
    res.json({ user: userToJson(user) });
  } catch (err) { next(err); }
}

async function deleteUser(req, res, next) {
  try {
    await adminService.deleteUser(req.params.id, { actorId: req.auth.userId, req });
    res.status(204).end();
  } catch (err) { next(err); }
}

async function restoreUser(req, res, next) {
  try {
    const user = await adminService.restoreUser(req.params.id, { actorId: req.auth.userId, req });
    res.json({ user: userToJson(user) });
  } catch (err) { next(err); }
}

// ============================================================
// AUDIT LOGS
// ============================================================

async function listAuditLogs(req, res, next) {
  try {
    const pag = parsePagination(req.query);
    const { rows, count } = await adminService.listAuditLogs({ ...req.query, ...pag });
    res.json(paginatedResponse({ rows, count, page: pag.page, pageSize: pag.pageSize, mapper: (r) => r.toJSON() }));
  } catch (err) { next(err); }
}

// ============================================================
// STATS
// ============================================================

async function getStats(req, res, next) {
  try {
    res.json(await adminService.getStats());
  } catch (err) { next(err); }
}

// ============================================================
// APPLICATIONS
// ============================================================

async function createApplication(req, res, next) {
  try {
    const { application, client_secret } = await applicationService.createApplication(
      req.body,
      { actorId: req.auth.userId, req }
    );
    res.status(201).json({
      application: application.toJSON(),
      client_secret,
      warning: client_secret
        ? 'Guarda este client_secret AHORA. No se mostrará otra vez.'
        : undefined,
    });
  } catch (err) { next(err); }
}

async function listApplications(req, res, next) {
  try {
    const pag = parsePagination(req.query);
    const { rows, count } = await applicationService.listApplications({ ...req.query, ...pag });
    res.json(paginatedResponse({
      rows, count, page: pag.page, pageSize: pag.pageSize,
      mapper: (a) => a.toJSON(),
    }));
  } catch (err) { next(err); }
}

async function getApplication(req, res, next) {
  try {
    const app = await applicationService.getApplication(req.params.id);
    res.json({ application: app.toJSON() });
  } catch (err) { next(err); }
}

async function updateApplication(req, res, next) {
  try {
    const app = await applicationService.updateApplication(req.params.id, req.body, {
      actorId: req.auth.userId,
      req,
    });
    res.json({ application: app.toJSON() });
  } catch (err) { next(err); }
}

async function deleteApplication(req, res, next) {
  try {
    await applicationService.deleteApplication(req.params.id, { actorId: req.auth.userId, req });
    res.status(204).end();
  } catch (err) { next(err); }
}

async function rotateClientSecret(req, res, next) {
  try {
    const { application, client_secret } = await applicationService.rotateClientSecret(
      req.params.id,
      { actorId: req.auth.userId, req }
    );
    res.json({
      application: application.toJSON(),
      client_secret,
      warning: 'Guarda este client_secret AHORA. No se mostrará otra vez.',
    });
  } catch (err) { next(err); }
}

// ============================================================
// INVITATIONS (admin endpoints)
// ============================================================

async function createInvitation(req, res, next) {
  try {
    const inv = await invitationService.createInvitation({
      email: req.body.email,
      role: req.body.role,
      actor: { userId: req.auth.userId, roles: req.auth.roles },
      req,
    });
    res.status(201).json({ invitation: inv.toJSON() });
  } catch (err) { next(err); }
}

async function listInvitations(req, res, next) {
  try {
    const pag = parsePagination(req.query);
    const { rows, count } = await invitationService.listInvitations({ ...req.query, ...pag });
    res.json(paginatedResponse({
      rows, count, page: pag.page, pageSize: pag.pageSize,
      mapper: (i) => i.toJSON(),
    }));
  } catch (err) { next(err); }
}

async function revokeInvitation(req, res, next) {
  try {
    await invitationService.revokeInvitation(req.params.id, {
      actor: { userId: req.auth.userId, roles: req.auth.roles },
      req,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}

// ============================================================
// SESSIONS
// ============================================================

async function listUserSessions(req, res, next) {
  try {
    const pag = parsePagination(req.query);
    const { rows, count } = await sessionService.listUserSessions(req.params.userId, { ...req.query, ...pag });
    res.json(paginatedResponse({
      rows, count, page: pag.page, pageSize: pag.pageSize,
      mapper: (s) => s.toJSON(),
    }));
  } catch (err) { next(err); }
}

async function revokeSession(req, res, next) {
  try {
    await sessionService.revokeSession(req.params.id, {
      actor: { userId: req.auth.userId },
      req,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}

// ============================================================
// API KEYS
// ============================================================

async function createApiKey(req, res, next) {
  try {
    const { apiKey, plain } = await apiKeyService.createApiKey({
      applicationId: req.params.appId,
      name: req.body.name,
      scopes: req.body.scopes,
      expiresAt: req.body.expires_at,
      actorId: req.auth.userId,
      req,
    });
    res.status(201).json({
      api_key: apiKey.toJSON(),
      plain_key: plain,
      warning: 'Guarda esta key AHORA. No se mostrará otra vez.',
    });
  } catch (err) { next(err); }
}

async function listApiKeys(req, res, next) {
  try {
    const pag = parsePagination(req.query);
    const { rows, count } = await apiKeyService.listApiKeys({
      applicationId: req.params.appId,
      q: { ...req.query, ...pag },
    });
    res.json(paginatedResponse({
      rows, count, page: pag.page, pageSize: pag.pageSize,
      mapper: (k) => k.toJSON(),
    }));
  } catch (err) { next(err); }
}

async function revokeApiKey(req, res, next) {
  try {
    await apiKeyService.revokeApiKey(req.params.id, {
      actorId: req.auth.userId,
      req,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}

async function revokeAllUserSessions(req, res, next) {
  try {
    const { revoked } = await sessionService.revokeAllForUser(req.params.userId, {
      actor: { userId: req.auth.userId },
      req,
    });
    res.json({ revoked });
  } catch (err) { next(err); }
}

module.exports = {
  // users
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  restoreUser,
  // audit
  listAuditLogs,
  // stats
  getStats,
  // applications
  createApplication,
  listApplications,
  getApplication,
  updateApplication,
  deleteApplication,
  rotateClientSecret,
  // invitations
  createInvitation,
  listInvitations,
  revokeInvitation,
  // sessions
  listUserSessions,
  revokeSession,
  revokeAllUserSessions,
  // api keys
  createApiKey,
  listApiKeys,
  revokeApiKey,
};
