'use strict';

/**
 * Convierte una clave pública RSA (PEM) a formato JWK (RFC 7517).
 * Usado en el endpoint /.well-known/jwks.json para que otros micros
 * validen JWT localmente sin llamar a este SSO.
 */

const crypto = require('node:crypto');
const config = require('../config/env');

let cachedJwks = null;

function publicKeyToJwk(pem, kid, alg = 'RS256') {
  const key = crypto.createPublicKey(pem);
  const jwk = key.export({ format: 'jwk' });
  return {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
    use: 'sig',
    alg,
    kid,
  };
}

function getJwks() {
  if (!cachedJwks) {
    cachedJwks = {
      keys: [publicKeyToJwk(config.jwt.publicKey, config.jwt.kid, config.jwt.algorithm)],
    };
  }
  return cachedJwks;
}

module.exports = { getJwks, publicKeyToJwk };
