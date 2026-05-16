'use strict';

const crypto = require('node:crypto');

/**
 * Token aleatorio base64url-safe (sin padding, sin '+/').
 * Usado para refresh tokens, email/password verify links.
 */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Código numérico de N dígitos (SMS).
 */
function randomNumericCode(length = 6) {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(length, '0');
}

/**
 * Prefijo visible para API keys: `sk_live_<8 hex>`.
 */
function apiKeyPrefix() {
  return 'sk_live_' + crypto.randomBytes(4).toString('hex');
}

/**
 * Genera una API key completa: `sk_live_<8 hex>_<32 bytes base64url>`.
 * Devuelve { plain, prefix, hash } — guarda solo `prefix` + `hash` en DB.
 */
function generateApiKey() {
  const prefix = apiKeyPrefix();
  const secret = crypto.randomBytes(32).toString('base64url');
  const plain = `${prefix}_${secret}`;
  const hash = crypto.createHash('sha256').update(plain).digest('hex');
  return { plain, prefix, hash };
}

module.exports = { randomToken, randomNumericCode, apiKeyPrefix, generateApiKey };
