'use strict';

/**
 * Cifrado simétrico AES-256-GCM para datos sensibles en DB.
 * Usado para `auth_providers.access_token_enc` y `refresh_token_enc`.
 *
 * Formato salida: base64( iv[12] || ciphertext || authTag[16] )
 *
 * ⚠ La key debe ser 32 bytes (256 bits) en hex desde env.ENCRYPTION_KEY.
 */

const crypto = require('node:crypto');
const config = require('../config/env');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey = null;
function getKey() {
  if (!cachedKey) {
    cachedKey = Buffer.from(config.encryption.keyHex, 'hex');
    if (cachedKey.length !== 32) {
      throw new Error('ENCRYPTION_KEY debe ser 32 bytes (64 chars hex)');
    }
  }
  return cachedKey;
}

function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

function decrypt(encB64) {
  if (encB64 == null) return null;
  const buf = Buffer.from(encB64, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Payload cifrado inválido');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
