'use strict';

const argon2 = require('argon2');
const crypto = require('node:crypto');

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

/**
 * Hashea una contraseña con Argon2id (OWASP 2024).
 */
async function hashPassword(plain) {
  return argon2.hash(plain, ARGON2_OPTS);
}

/**
 * Verifica una contraseña contra su hash Argon2.
 * Devuelve `true` si coincide.
 */
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * SHA-256 hex de un valor (para tokens almacenados).
 * Nunca guardar tokens en plano: guardar sha256.
 */
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Compara dos strings en tiempo constante (resistente a timing attacks).
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { hashPassword, verifyPassword, sha256, safeEqual };
