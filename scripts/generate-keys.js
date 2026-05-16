// Genera par de claves RSA 4096 bits para firmar JWT con RS256.
// Uso: npm run keys:generate
//
// Salida:
//   src/keys/private.pem  → solo este servicio, firma JWT
//   src/keys/public.pem   → expuesto vía /.well-known/jwks.json a otros micro
//
// IMPORTANTE:
// - NUNCA commitear estas claves (ya está en .gitignore).
// - En producción usar gestor de secretos (Vault, AWS Secrets Manager, etc).
// - Para rotar: generar par nuevo con kid distinto y mantener el anterior
//   en JWKS hasta que todos los tokens emitidos con la vieja expiren.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const KEYS_DIR = path.resolve(__dirname, '..', 'src', 'keys');
const PRIVATE_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_PATH = path.join(KEYS_DIR, 'public.pem');

function abortIfExists() {
  const exists = fs.existsSync(PRIVATE_PATH) || fs.existsSync(PUBLIC_PATH);
  if (!exists) return;

  if (!process.argv.includes('--force')) {
    console.error('✖ Las claves ya existen. Usa --force para sobrescribir.');
    console.error('  Sobrescribir invalidará todos los tokens emitidos previamente.');
    process.exit(1);
  }
  console.warn('⚠ Sobrescribiendo claves existentes (--force).');
}

function generate() {
  console.log('→ Generando par RSA 4096 bits...');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(PRIVATE_PATH, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_PATH, publicKey, { mode: 0o644 });

  console.log(`✔ Privada: ${PRIVATE_PATH} (chmod 600)`);
  console.log(`✔ Pública: ${PUBLIC_PATH}`);
}

abortIfExists();
generate();
