/**
 * migrate-prod-users.js
 *
 * Migra los 119 usuarios del API-V6 original (prod) al SSO GEMMATEX.
 *
 * Prerequisitos:
 *   1. SSO corriendo en localhost:2106
 *   2. Tunnel SSH activo:  ssh -L 5433:localhost:5432 root@<VPS_IP> -N &
 *   3. npm install pg axios  (en este directorio o globalmente)
 *
 * Uso:
 *   node scripts/migrate-prod-users.js
 *   node scripts/migrate-prod-users.js --dry-run   # solo muestra, no crea
 *   node scripts/migrate-prod-users.js --send-reset # envía emails reset al final
 */

'use strict';

const { Pool } = require('pg');
const axios   = require('axios');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const PROD_DB = {
  host:     process.env.PROD_DB_HOST     || 'localhost',
  port:     parseInt(process.env.PROD_DB_PORT, 10) || 5433,  // SSH tunnel: ssh -L 5433:localhost:5432 root@<VPS_IP> -N
  user:     process.env.PROD_DB_USER     || 'postgres',
  password: process.env.PROD_DB_PASSWORD || '',
  database: process.env.PROD_DB_NAME     || 'CATALOGO_GEMMA',
  ssl:      false,
};

if (!PROD_DB.password) {
  console.error('ERROR: PROD_DB_PASSWORD no seteado. Exportar antes de correr.');
  process.exit(1);
}

const SSO_URL       = 'http://localhost:2106/api/v1';
const SSO_CLIENT_ID = 'app_ecommerce_dev';
const MAPPING_FILE  = path.join(__dirname, 'migration-mapping.json');

const DRY_RUN    = process.argv.includes('--dry-run');
const SEND_RESET = process.argv.includes('--send-reset');

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return '+59170000000';
  const p = raw.trim().replace(/[\s\-().]/g, '');
  if (p.startsWith('+591')) return p;
  if (p.startsWith('591'))  return `+${p}`;
  return `+591${p}`;
}

function tempPassword() {
  // Random 20-char string that satisfies any basic strength check
  return crypto.randomBytes(12).toString('hex') + 'Aa1!';
}

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`MIGRACIÓN USUARIOS PROD → SSO GEMMATEX`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (sin cambios)' : 'REAL'}`);
  console.log(`${'═'.repeat(60)}\n`);

  const pool = new Pool(PROD_DB);

  // 1. Leer todos los usuarios activos + datos de customer
  const { rows: users } = await pool.query(`
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

  console.log(`Usuarios encontrados en prod: ${users.length}\n`);

  const mapping  = [];
  const failed   = [];
  const skipped  = [];

  for (const [i, user] of users.entries()) {
    const email = user.email?.trim().toLowerCase();
    if (!email) {
      console.warn(`  [${i + 1}] Sin email, skip`);
      skipped.push({ user_id: user.user_id, reason: 'no_email' });
      continue;
    }

    const firstName = user.name?.trim()      || email.split('@')[0];
    const lastName  = user.last_name?.trim() || '-';
    const phone     = normalizePhone(user.phone);
    const pwd       = tempPassword();

    process.stdout.write(`  [${String(i + 1).padStart(3)}] ${email.padEnd(40)} → `);

    if (DRY_RUN) {
      console.log('(dry-run skip)');
      mapping.push({
        old_user_id: user.user_id, old_customer_id: user.customer_id,
        email, sso_uuid: 'DRY_RUN', was_verified: user.is_email_verified,
      });
      continue;
    }

    try {
      const res = await axios.post(
        `${SSO_URL}/auth/register`,
        {
          email,
          password:   pwd,
          first_name: firstName,
          last_name:  lastName,
          phone,
        },
        {
          headers: { 'X-Client-Id': SSO_CLIENT_ID },
          timeout: 15000,
        }
      );

      const ssoUser = res.data.user;
      console.log(`✓  ${ssoUser.id}`);

      mapping.push({
        old_user_id:    user.user_id,
        old_customer_id: user.customer_id,
        email,
        sso_uuid:       ssoUser.id,
        was_verified:   user.is_email_verified,
        first_name:     firstName,
        last_name:      lastName,
        phone,
        city:           user.city,
      });

    } catch (err) {
      const status = err.response?.status;
      const msg    = err.response?.data?.message || err.message;

      if (status === 409) {
        console.log(`⚠  ya existe en SSO`);
        skipped.push({ email, reason: 'already_exists' });
      } else {
        console.log(`✗  ${msg}`);
        failed.push({ email, error: msg });
      }
    }

    await delay(350); // Evita saturar argon2 del SSO
  }

  // 2. Guardar mapping
  if (!DRY_RUN) {
    fs.writeFileSync(MAPPING_FILE, JSON.stringify({ mapping, failed, skipped }, null, 2));
    console.log(`\nMapping guardado en: ${MAPPING_FILE}`);
  }

  // 3. Resumen
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Creados:  ${mapping.length}`);
  console.log(`Ya existían: ${skipped.length}`);
  console.log(`Fallidos: ${failed.length}`);
  if (failed.length > 0) {
    console.log('\nFallidos:');
    failed.forEach(f => console.log(`  ${f.email}: ${f.error}`));
  }

  // 4. Opcional: enviar reset-password a todos los migrados
  if (SEND_RESET && !DRY_RUN && mapping.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Enviando emails de reset password...\n`);

    for (const m of mapping) {
      process.stdout.write(`  Reset → ${m.email.padEnd(40)} `);
      try {
        await axios.post(
          `${SSO_URL}/auth/forgot-password`,
          { email: m.email },
          { headers: { 'X-Client-Id': SSO_CLIENT_ID }, timeout: 10000 }
        );
        console.log('✓');
      } catch (err) {
        console.log(`✗ ${err.response?.data?.message || err.message}`);
      }
      await delay(500); // Evita saturar SMTP
    }
  } else if (!SEND_RESET && !DRY_RUN && mapping.length > 0) {
    console.log('\nPara enviar emails de reset:');
    console.log('  node scripts/migrate-prod-users.js --send-reset');
  }

  await pool.end();
  console.log('\n✓ Migración completada.\n');
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
