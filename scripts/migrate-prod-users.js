/**
 * migrate-prod-users.js
 *
 * Migra usuarios del API-V6 viejo (DB CATALOGO_GEMMA) al SSO GEMMATEX.
 *
 * Diseño:
 * - Corre EN el mismo VPS donde están las 2 DBs. No usa HTTP, accede directo a
 *   SSO via Sequelize models y a la DB vieja via pg.Pool.
 * - Cada usuario migrado nace con:
 *     status='active', email_verified_at=NOW (estaban verificados antes),
 *     password aleatoria (no se usa, el user fija la suya con el reset link),
 *     rol 'client' asignado.
 * - Se genera un password_reset token con TTL extendido (24h) y se envía un
 *   email "migration-welcome" único con el link "Crear mi contraseña".
 * - Idempotente: si el email ya existe en SSO, se omite.
 *
 * Uso:
 *   PROD_DB_PASSWORD=xxxx node scripts/migrate-prod-users.js --dry-run
 *   PROD_DB_PASSWORD=xxxx node scripts/migrate-prod-users.js
 *   PROD_DB_PASSWORD=xxxx node scripts/migrate-prod-users.js --only=user@email.com
 *
 * Flags:
 *   --dry-run               solo lee, no escribe ni manda emails
 *   --only=<email>          procesa solo ese email
 *   --no-email              registra usuarios pero NO manda email (debug)
 *
 * Output:
 *   scripts/migration-mapping.json — { mapping, skipped, failed }
 */

'use strict';

const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { sequelize, User, ClientProfile, Role, UserRole, PasswordReset } =
  require('../src/db/models');
const { hashPassword, sha256 } = require('../src/utils/hash');
const { randomToken } = require('../src/utils/random');
const emailService = require('../src/services/email.service');

// ── Config ────────────────────────────────────────────────────────────────────

const PROD_DB = {
  host:     process.env.PROD_DB_HOST     || 'localhost',
  port:     parseInt(process.env.PROD_DB_PORT, 10) || 5432,
  user:     process.env.PROD_DB_USER     || 'postgres',
  password: process.env.PROD_DB_PASSWORD || '',
  database: process.env.PROD_DB_NAME     || 'CATALOGO_GEMMA',
  ssl:      false,
};

if (!PROD_DB.password) {
  console.error('ERROR: PROD_DB_PASSWORD no seteado.');
  process.exit(1);
}

const MAPPING_FILE = path.join(__dirname, 'migration-mapping.json');
const DRY_RUN  = process.argv.includes('--dry-run');
const NO_EMAIL = process.argv.includes('--no-email');
const ONLY     = (() => {
  const f = process.argv.find((a) => a.startsWith('--only='));
  return f ? f.slice('--only='.length).trim().toLowerCase() : null;
})();

const RESET_TTL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return null;
  const p = String(raw).trim().replace(/[\s\-().]/g, '');
  if (/^\+591\d{8}$/.test(p)) return p;
  if (/^591\d{8}$/.test(p))   return '+' + p;
  if (/^\d{8}$/.test(p))      return '+591' + p;
  return null; // no rescatable
}

// Phone único fallback derivado del UUID: +591 + 8 dígitos pseudo-únicos
function placeholderPhone(uuid) {
  const hex = uuid.replace(/-/g, '').slice(-10);
  const int = parseInt(hex, 16) % 100000000;
  return '+591' + String(int).padStart(8, '0');
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`MIGRACIÓN USUARIOS PROD → SSO GEMMATEX`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'REAL'}${NO_EMAIL ? ' (sin email)' : ''}${ONLY ? ` (solo: ${ONLY})` : ''}`);
  console.log(`${'═'.repeat(60)}\n`);

  await sequelize.authenticate();
  console.log('✓ SSO DB conectada');

  const clientRole = await Role.findOne({ where: { name: 'client' } });
  if (!clientRole) {
    console.error('ERROR: rol "client" no existe en SSO. Corre seeders.');
    process.exit(1);
  }
  console.log(`✓ Rol client id=${clientRole.id}\n`);

  const prodPool = new Pool(PROD_DB);

  const { rows: prodUsers } = await prodPool.query(`
    SELECT
      u.id            AS user_id,
      u.email,
      u.is_email_verified,
      c.id            AS customer_id,
      c.name,
      c.last_name,
      c.phone,
      c.city,
      c.street,
      c.street_number,
      c.apartment
    FROM users u
    LEFT JOIN customers c ON c.user_id = u.id
    WHERE u.is_active = true
    ORDER BY u.id
  `);

  const filtered = ONLY
    ? prodUsers.filter((u) => u.email?.trim().toLowerCase() === ONLY)
    : prodUsers;

  console.log(`Usuarios en prod: ${prodUsers.length}`);
  if (ONLY) console.log(`Filtrados a "${ONLY}": ${filtered.length}\n`);
  else console.log('');

  const mapping = [];
  const skipped = [];
  const failed  = [];

  for (const [i, prod] of filtered.entries()) {
    const email = prod.email?.trim().toLowerCase();
    if (!email) {
      skipped.push({ old_user_id: prod.user_id, reason: 'no_email' });
      console.log(`  [${i + 1}] (sin email, skip)`);
      continue;
    }

    process.stdout.write(`  [${String(i + 1).padStart(3)}] ${email.padEnd(40)} `);

    try {
      // Check existencia. Si ya migrado, agregamos a mapping para que
      // migrate-prod-orders pueda resolver customer_id → sso_uuid.
      const existing = await User.findOne({ where: { email } });
      if (existing) {
        console.log('⚠ ya existe en SSO');
        skipped.push({ old_user_id: prod.user_id, email, reason: 'already_exists', sso_uuid: existing.id });
        mapping.push({
          old_user_id:     prod.user_id,
          old_customer_id: prod.customer_id,
          email,
          sso_uuid:        existing.id,
          first_name:      prod.name?.trim() || email.split('@')[0],
          last_name:       prod.last_name?.trim() || 'Cliente',
          was_verified:    prod.is_email_verified,
          email_status:    'pre_existing',
        });
        continue;
      }

      const firstName = prod.name?.trim()      || email.split('@')[0];
      const lastName  = prod.last_name?.trim() || 'Cliente';

      // Phone: usa el prod o genera placeholder único
      let phone = normalizePhone(prod.phone);

      if (DRY_RUN) {
        console.log('(dry-run skip)');
        mapping.push({
          old_user_id: prod.user_id,
          old_customer_id: prod.customer_id,
          email, sso_uuid: 'DRY_RUN', first_name: firstName, last_name: lastName,
          phone, was_verified: prod.is_email_verified,
        });
        continue;
      }

      // Pre-check duplicado de phone ANTES de la transacción.
      // Si ya está usado por otro user en SSO, usamos placeholder.
      // Postgres aborta la transacción al violar UNIQUE, así que no podemos
      // retry adentro del transaction block.
      if (phone) {
        const phoneInUse = await ClientProfile.findOne({ where: { phone } });
        if (phoneInUse) phone = null;
      }

      // Password temp aleatoria (nunca comunicada al usuario, sólo placeholder)
      const tempPassword = randomToken(20);
      const pwdHash = await hashPassword(tempPassword);

      const result = await sequelize.transaction(async (t) => {
        const user = await User.create(
          {
            email,
            password_hash:        pwdHash,
            status:               'active',
            email_verified_at:    new Date(), // estaban verificados en prod vieja
            failed_login_attempts: 0,
            password_changed_at:  new Date(),
            totp_enabled:         false,
          },
          { transaction: t }
        );

        const effectivePhone = phone || placeholderPhone(user.id);

        await ClientProfile.create(
          {
            user_id:    user.id,
            first_name: firstName,
            last_name:  lastName,
            phone:      effectivePhone,
            ciudad:     prod.city          || null,
            calle_avenida: prod.street     || null,
            numero:     prod.street_number || null,
            casa_dpto:  prod.apartment     || null,
            country:    'BO',
          },
          { transaction: t }
        );

        await UserRole.create(
          { user_id: user.id, role_id: clientRole.id, assigned_at: new Date() },
          { transaction: t }
        );

        // Token reset con TTL extendido
        const plainToken = randomToken(32);
        await PasswordReset.create(
          {
            user_id:    user.id,
            token_hash: sha256(plainToken),
            expires_at: new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000),
            ip:         null,
            user_agent: 'migration-script',
          },
          { transaction: t }
        );

        return { user, plainToken, effectivePhone, firstName };
      });

      // Email fuera de transacción (best effort)
      let emailStatus = 'skipped';
      if (!NO_EMAIL) {
        try {
          await emailService.sendMigrationWelcomeEmail({
            to:         email,
            firstName:  result.firstName,
            token:      result.plainToken,
            ttlHours:   RESET_TTL_HOURS,
          });
          emailStatus = 'sent';
        } catch (e) {
          emailStatus = 'failed:' + e.message.slice(0, 60);
        }
      }

      console.log(`✓ ${result.user.id} (email=${emailStatus})`);

      mapping.push({
        old_user_id:     prod.user_id,
        old_customer_id: prod.customer_id,
        email,
        sso_uuid:        result.user.id,
        first_name:      result.firstName,
        last_name:       lastName,
        phone:           result.effectivePhone,
        was_verified:    prod.is_email_verified,
        email_status:    emailStatus,
      });

      await delay(350); // evita saturar argon2 + SMTP
    } catch (err) {
      console.log(`✗ ${err.message.slice(0, 80)}`);
      failed.push({ old_user_id: prod.user_id, email, error: err.message });
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(MAPPING_FILE, JSON.stringify({ mapping, skipped, failed }, null, 2));
    console.log(`\nMapping guardado en: ${MAPPING_FILE}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Migrados:     ${mapping.length}`);
  console.log(`Saltados:     ${skipped.length}`);
  console.log(`Fallidos:     ${failed.length}`);
  if (failed.length > 0) {
    console.log('\nFallidos detalle:');
    failed.forEach((f) => console.log(`  ${f.email}: ${f.error}`));
  }

  await prodPool.end();
  await sequelize.close();
  console.log('\n✓ Migración completada.\n');
}

main().catch(async (err) => {
  console.error('\nError fatal:', err);
  try { await sequelize.close(); } catch {}
  process.exit(1);
});
