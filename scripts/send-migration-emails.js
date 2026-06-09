/**
 * send-migration-emails.js
 *
 * Envia el email migration-welcome a usuarios migrados que no recibieron
 * el correo durante la migracion (--no-email) y que NO han iniciado sesion
 * todavia (last_login_at = null).
 *
 * Para cada user:
 *   - Si tiene password_reset activo (no usado, no expirado) → reusa token
 *   - Si no → genera token nuevo con TTL 24h
 *   - Envia email migration-welcome
 *   - Marca email_status='sent' en mapping.json
 *
 * Idempotente:
 *   - Skip si last_login_at != NULL (usuario ya completo el flujo)
 *   - Skip si email_status='sent' en mapping (a menos que --force)
 *
 * Uso:
 *   node scripts/send-migration-emails.js                  # real
 *   node scripts/send-migration-emails.js --dry-run        # no manda, solo lista
 *   node scripts/send-migration-emails.js --only=user@x    # solo ese email
 *   node scripts/send-migration-emails.js --force          # reenvia aunque email_status='sent'
 *   node scripts/send-migration-emails.js --delay-ms=600   # delay entre envios
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { sequelize, User, PasswordReset } = require('../src/db/models');
const { sha256 } = require('../src/utils/hash');
const { randomToken } = require('../src/utils/random');
const emailService = require('../src/services/email.service');

const MAPPING_FILE = path.join(__dirname, 'migration-mapping.json');
const RESET_TTL_HOURS = 24;

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');
const ONLY    = (() => {
  const f = process.argv.find((a) => a.startsWith('--only='));
  return f ? f.slice('--only='.length).trim().toLowerCase() : null;
})();
const DELAY_MS = (() => {
  const f = process.argv.find((a) => a.startsWith('--delay-ms='));
  return f ? parseInt(f.slice('--delay-ms='.length), 10) : 500;
})();

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`SEND MIGRATION-WELCOME EMAILS`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'REAL'}${ONLY ? ` (solo: ${ONLY})` : ''}${FORCE ? ' (force)' : ''}`);
  console.log(`Delay: ${DELAY_MS}ms`);
  console.log(`${'═'.repeat(60)}\n`);

  if (!fs.existsSync(MAPPING_FILE)) {
    console.error('ERROR: migration-mapping.json no existe.');
    process.exit(1);
  }

  await sequelize.authenticate();
  console.log('✓ SSO DB conectada');

  const data = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
  let targets = data.mapping.filter((m) => m.email && m.sso_uuid && m.sso_uuid !== 'DRY_RUN');

  if (ONLY) targets = targets.filter((m) => m.email.toLowerCase() === ONLY);

  console.log(`Candidatos: ${targets.length}\n`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, m] of targets.entries()) {
    const tag = `[${String(i + 1).padStart(3)}/${targets.length}]`;
    const email = m.email;
    process.stdout.write(`  ${tag} ${email.padEnd(45)} `);

    try {
      const user = await User.findByPk(m.sso_uuid);
      if (!user) {
        console.log('✗ user no existe en SSO');
        skipped++;
        continue;
      }

      if (user.last_login_at) {
        console.log(`⚠ ya inicio sesion (${user.last_login_at.toISOString().slice(0, 16)}), skip`);
        skipped++;
        continue;
      }

      if (!FORCE && m.email_status === 'sent') {
        console.log('⚠ ya enviado (use --force para reenviar), skip');
        skipped++;
        continue;
      }

      // Buscar password_reset activo, o crear nuevo
      const now = new Date();
      let activeReset = await PasswordReset.findOne({
        where: { user_id: user.id, used_at: null },
        order: [['created_at', 'DESC']],
      });

      let plainToken;
      if (activeReset && activeReset.expires_at > now) {
        // Tenemos token activo. Pero no podemos recuperar el plain (solo guardamos hash).
        // Asi que invalidamos el viejo y generamos uno nuevo.
        await activeReset.update({ used_at: now });
        plainToken = randomToken(32);
      } else {
        plainToken = randomToken(32);
      }

      if (DRY_RUN) {
        console.log('(dry-run skip, token generaria)');
        continue;
      }

      // Crear nuevo password_reset con plainToken
      await PasswordReset.create({
        user_id:    user.id,
        token_hash: sha256(plainToken),
        expires_at: new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000),
        ip:         null,
        user_agent: 'send-migration-emails-script',
      });

      // Envia email
      await emailService.sendMigrationWelcomeEmail({
        to:        email,
        firstName: m.first_name || email.split('@')[0],
        token:     plainToken,
        ttlHours:  RESET_TTL_HOURS,
      });

      m.email_status = 'sent';
      m.email_sent_at = new Date().toISOString();
      console.log('✓ enviado');
      sent++;

      await delay(DELAY_MS);
    } catch (err) {
      console.log(`✗ ${err.message.slice(0, 80)}`);
      failed++;
    }
  }

  // Update mapping
  if (!DRY_RUN) {
    fs.writeFileSync(MAPPING_FILE, JSON.stringify(data, null, 2));
    console.log(`\nMapping actualizado: ${MAPPING_FILE}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Enviados:    ${sent}`);
  console.log(`Saltados:    ${skipped}`);
  console.log(`Fallidos:    ${failed}`);

  await sequelize.close();
  console.log('\n✓ Done.\n');
}

main().catch(async (err) => {
  console.error('\nError fatal:', err.stack || err.message);
  try { await sequelize.close(); } catch {}
  process.exit(1);
});
