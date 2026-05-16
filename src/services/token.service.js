'use strict';

const { uuidv7 } = require('uuidv7');
const { Op } = require('sequelize');
const { RefreshToken, sequelize } = require('../db/models');
const { signAccessToken } = require('../utils/jwt');
const { randomToken, sha256 } = (() => {
  const r = require('../utils/random');
  const h = require('../utils/hash');
  return { randomToken: r.randomToken, sha256: h.sha256 };
})();
const config = require('../config/env');

/**
 * Emite un par de tokens (access + refresh) para un user en una application.
 * Crea un nuevo `family_id` (no es rotación, es login fresco).
 */
async function issueTokenPair({ user, roles, application, ip, userAgent }) {
  const familyId = uuidv7();
  return rotateTokenPair({
    user,
    roles,
    application,
    familyId,
    ip,
    userAgent,
  });
}

/**
 * Crea un access + refresh nuevo, opcionalmente marcando el `previousId`
 * como reemplazado (rotación dentro de una family).
 */
async function rotateTokenPair({
  user,
  roles,
  application,
  familyId,
  previousId = null,
  ip,
  userAgent,
  transaction,
}) {
  const refreshPlain = randomToken(48);
  const refreshHash = sha256(refreshPlain);
  const expiresAt = new Date(
    Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000
  );

  const tokenRow = await RefreshToken.create(
    {
      user_id: user.id,
      application_id: application.id,
      token_hash: refreshHash,
      family_id: familyId,
      expires_at: expiresAt,
      ip,
      user_agent: userAgent,
    },
    { transaction }
  );

  if (previousId) {
    await RefreshToken.update(
      {
        revoked_at: new Date(),
        revoked_reason: 'rotation',
        replaced_by: tokenRow.id,
      },
      { where: { id: previousId }, transaction }
    );
  }

  const accessToken = signAccessToken({
    userId: user.id,
    roles,
    audience: application.audience,
    applicationId: application.id,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshPlain,
    token_type: 'Bearer',
    expires_in: parseTtlSeconds(config.jwt.accessTtl),
    refresh_token_expires_at: expiresAt.toISOString(),
  };
}

/**
 * Valida un refresh token y devuelve la fila DB si está activo.
 * Si detecta robo (token revocado y reusado), revoca toda la family.
 * Lanza error si no válido.
 */
async function validateRefreshToken(refreshPlain) {
  const refreshHash = sha256(refreshPlain);
  const row = await RefreshToken.findOne({ where: { token_hash: refreshHash } });

  if (!row) {
    const err = new Error('Refresh token no encontrado');
    err.code = 'INVALID_REFRESH';
    throw err;
  }

  if (row.revoked_at) {
    // Token ya revocado pero alguien lo usa de nuevo → posible robo.
    // Revoca toda la familia para invalidar al ladrón.
    await RefreshToken.update(
      { revoked_at: new Date(), revoked_reason: 'theft_detected' },
      { where: { family_id: row.family_id, revoked_at: null } }
    );
    const err = new Error('Refresh token revocado, posible robo detectado');
    err.code = 'REFRESH_REVOKED';
    err.familyId = row.family_id;
    err.userId = row.user_id;
    throw err;
  }

  if (row.expires_at <= new Date()) {
    const err = new Error('Refresh token expirado');
    err.code = 'REFRESH_EXPIRED';
    throw err;
  }

  return row;
}

/**
 * Revoca un refresh token específico (logout simple).
 */
async function revokeRefreshToken(tokenId, reason = 'logout') {
  await RefreshToken.update(
    { revoked_at: new Date(), revoked_reason: reason },
    { where: { id: tokenId, revoked_at: null } }
  );
}

/**
 * Revoca todos los refresh tokens activos de un usuario (logout-all,
 * cambio password, suspensión).
 */
async function revokeAllForUser(userId, reason = 'admin') {
  await RefreshToken.update(
    { revoked_at: new Date(), revoked_reason: reason },
    { where: { user_id: userId, revoked_at: null } }
  );
}

// "15m" → 900, "1h" → 3600. Sin lib externa.
function parseTtlSeconds(s) {
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) return 900;
  const n = Number(m[1]);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return n * mult;
}

module.exports = {
  issueTokenPair,
  rotateTokenPair,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  parseTtlSeconds,
};
