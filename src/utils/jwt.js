'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');

/**
 * Firma un access token JWT con RS256.
 *
 * Claims estándar:
 *   sub      → user_id
 *   iss      → config.jwt.issuer
 *   aud      → audience(s) — qué app(s) puede consumir
 *   exp      → manejado por `expiresIn`
 *   iat      → automático
 *   kid      → en header, para JWKS lookup
 *
 * Claims custom:
 *   roles    → array de nombres de rol
 *   app_id   → id de la application emisora
 */
function signAccessToken({ userId, roles, audience, applicationId, extra = {} }) {
  const payload = {
    roles,
    app_id: applicationId,
    ...extra,
  };

  return jwt.sign(payload, config.jwt.privateKey, {
    algorithm: config.jwt.algorithm,
    expiresIn: config.jwt.accessTtl,
    issuer: config.jwt.issuer,
    audience,
    subject: userId,
    keyid: config.jwt.kid,
  });
}

/**
 * Verifica un access token JWT contra la clave pública.
 * Devuelve los claims si es válido. Lanza error si no.
 */
function verifyAccessToken(token, { audience } = {}) {
  return jwt.verify(token, config.jwt.publicKey, {
    algorithms: [config.jwt.algorithm],
    issuer: config.jwt.issuer,
    ...(audience ? { audience } : {}),
  });
}

/**
 * Decodifica sin verificar (debug only — NUNCA usar en producción para auth).
 */
function decodeToken(token) {
  return jwt.decode(token, { complete: true });
}

module.exports = { signAccessToken, verifyAccessToken, decodeToken };
