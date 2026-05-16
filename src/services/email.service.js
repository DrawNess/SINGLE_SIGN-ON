'use strict';

const nodemailer = require('nodemailer');
const config = require('../config/env');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.password },
      // Timeouts razonables para no colgar la app si SMTP no responde
      connectionTimeout: 8000,
      socketTimeout: 8000,
    });
  }
  return transporter;
}

/**
 * Envía un email. En desarrollo, si SMTP falla, imprime el contenido
 * en consola (para poder seguir testeando sin SMTP real).
 */
async function send({ to, subject, html, text }) {
  const from = `"${config.mail.fromName}" <${config.mail.fromEmail}>`;
  // En dev, log siempre del subject + URLs presentes en el cuerpo
  if (config.isDev) {
    devLogEmail({ to, subject, text, html });
  }
  try {
    const info = await getTransporter().sendMail({ from, to, subject, html, text });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    if (config.isDev) {
      console.warn(`[mail] SMTP falló (${err.message}). Mostrando en consola:`);
      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('  📧 EMAIL (dev fallback — SMTP no disponible)');
      console.log('═══════════════════════════════════════════════════════');
      console.log(`  To:      ${to}`);
      console.log(`  Subject: ${subject}`);
      console.log('  ---------------------------------------------------');
      console.log(text || stripHtml(html));
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
      return { ok: false, fallback: 'console', error: err.message };
    }
    throw err;
  }
}

/**
 * En desarrollo, imprime un resumen del email en consola (subject + URLs)
 * para poder testear sin tener que recibir el email real.
 */
function devLogEmail({ to, subject, text, html }) {
  const body = text || stripHtml(html);
  const urls = body.match(/https?:\/\/[^\s<>"']+/g) || [];
  console.log('');
  console.log('───── 📧 EMAIL (dev log) ──────────────────────────────');
  console.log(`  To:      ${to}`);
  console.log(`  Subject: ${subject}`);
  if (urls.length > 0) {
    console.log(`  URLs:`);
    urls.forEach((u) => console.log(`    → ${u}`));
  }
  console.log('───────────────────────────────────────────────────────');
  console.log('');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildUrl(template, token) {
  return template.replace('{token}', encodeURIComponent(token));
}

// ============================================================
// Plantillas
// ============================================================

function verificationTemplate({ firstName, verifyUrl, ttlHours }) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Verifica tu cuenta</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #0a4d8f;">Bienvenido a GEMMATEX</h2>
  <p>Hola ${escapeHtml(firstName)},</p>
  <p>Gracias por crear una cuenta. Para activarla, confirma tu correo haciendo click en el botón:</p>
  <p style="text-align: center; margin: 32px 0;">
    <a href="${verifyUrl}" style="background:#0a4d8f; color:#fff; text-decoration:none; padding:12px 28px; border-radius:4px; display:inline-block;">
      Verificar correo
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">O copia este link en tu navegador:</p>
  <p style="font-size: 13px; word-break: break-all;"><a href="${verifyUrl}">${verifyUrl}</a></p>
  <p style="font-size: 13px; color: #666;">Este link expira en ${ttlHours} horas.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
  <p style="font-size: 12px; color: #999;">Si no fuiste tú, ignora este correo.<br>— GEMMATEX SSO</p>
</body>
</html>`;
  const text = `Hola ${firstName},

Gracias por crear una cuenta GEMMATEX. Verifica tu correo:

${verifyUrl}

Este link expira en ${ttlHours} horas.

Si no fuiste tú, ignora este correo.
— GEMMATEX SSO`;
  return { html, text };
}

function emailChangeTemplate({ firstName, newEmail, confirmUrl, ttlHours }) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Confirma cambio de correo</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #0a4d8f;">Confirma el cambio de correo</h2>
  <p>Hola ${escapeHtml(firstName)},</p>
  <p>Solicitaste cambiar tu correo a <strong>${escapeHtml(newEmail)}</strong>. Confirma haciendo click:</p>
  <p style="text-align: center; margin: 32px 0;">
    <a href="${confirmUrl}" style="background:#0a4d8f; color:#fff; text-decoration:none; padding:12px 28px; border-radius:4px; display:inline-block;">
      Confirmar nuevo correo
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">Este link expira en ${ttlHours} horas.</p>
  <p style="font-size: 13px; color: #666;">Tras confirmar, deberás iniciar sesión nuevamente en todos tus dispositivos.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
  <p style="font-size: 12px; color: #999;">Si no fuiste tú, ignora este correo y revisa la seguridad de tu cuenta.<br>— GEMMATEX SSO</p>
</body>
</html>`;
  const text = `Hola ${firstName},

Solicitaste cambiar tu correo a ${newEmail}. Confirma:

${confirmUrl}

Tras confirmar, deberás iniciar sesión nuevamente en todos tus dispositivos.

Si no fuiste tú, ignora este correo.
— GEMMATEX SSO`;
  return { html, text };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// Helpers de envío específicos
// ============================================================

async function sendVerificationEmail({ to, firstName, token }) {
  const verifyUrl = buildUrl(config.mail.verifyUrlTemplate, token);
  const { html, text } = verificationTemplate({
    firstName,
    verifyUrl,
    ttlHours: config.security.emailVerifyTtlHours,
  });
  return send({ to, subject: 'Verifica tu cuenta GEMMATEX', html, text });
}

async function sendEmailChangeEmail({ to, firstName, newEmail, token }) {
  const confirmUrl = buildUrl(config.mail.changeUrlTemplate, token);
  const { html, text } = emailChangeTemplate({
    firstName,
    newEmail,
    confirmUrl,
    ttlHours: config.security.emailVerifyTtlHours,
  });
  return send({ to, subject: 'Confirma el cambio de correo', html, text });
}

module.exports = {
  send,
  sendVerificationEmail,
  sendEmailChangeEmail,
  buildUrl,
};
