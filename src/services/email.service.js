'use strict';

const nodemailer = require('nodemailer');
const config = require('../config/env');
const { render, escapeHtml } = require('./email/render');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.password },
      connectionTimeout: 8000,
      socketTimeout: 8000,
    });
  }
  return transporter;
}

/**
 * Envía un email. En desarrollo, además del envío vía SMTP, imprime un
 * resumen (subject + URLs) en consola para poder testear sin recibirlo.
 * Si SMTP falla en dev, el contenido también queda en consola.
 */
async function send({ to, subject, html, text }) {
  const from = `"${config.mail.fromName}" <${config.mail.fromEmail}>`;
  if (config.isDev) devLogEmail({ to, subject, text, html });

  try {
    const info = await getTransporter().sendMail({ from, to, subject, html, text });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    if (config.isDev) {
      console.warn(`[mail] SMTP falló (${err.message}). Email mostrado arriba.`);
      return { ok: false, fallback: 'console', error: err.message };
    }
    throw err;
  }
}

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
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildUrl(template, token) {
  return template.replace('{token}', encodeURIComponent(token));
}

// ============================================================
// Helpers de envío específicos
// ============================================================

async function sendVerificationEmail({ to, firstName, token }) {
  const verifyUrl = buildUrl(config.mail.verifyUrlTemplate, token);
  const html = render('verify', {
    firstName: escapeHtml(firstName || ''),
    verifyUrl,
    ttlHours: config.security.emailVerifyTtlHours,
  });
  const text = `Hola ${firstName},

Para activar tu cuenta GEMMATEX, verifica tu correo:

${verifyUrl}

Este link expira en ${config.security.emailVerifyTtlHours} horas.

Si no fuiste tú, ignora este mensaje.
— GEMMATEX`;
  return send({ to, subject: 'Verifica tu correo · Gemmatex', html, text });
}

async function sendEmailChangeEmail({ to, firstName, newEmail, token }) {
  const confirmUrl = buildUrl(config.mail.changeUrlTemplate, token);
  const html = render('change', {
    firstName: escapeHtml(firstName || ''),
    newEmail: escapeHtml(newEmail),
    confirmUrl,
    ttlHours: config.security.emailVerifyTtlHours,
  });
  const text = `Hola ${firstName},

Solicitaste cambiar tu correo a ${newEmail}. Confirma:

${confirmUrl}

Tras confirmar deberás iniciar sesión nuevamente en todos tus dispositivos.

Si no fuiste tú, ignora este mensaje.
— GEMMATEX`;
  return send({ to, subject: 'Confirma el cambio de correo · Gemmatex', html, text });
}

async function sendPasswordResetEmail({ to, firstName, token }) {
  const resetUrl = buildUrl(config.mail.resetUrlTemplate, token);
  const html = render('reset', {
    firstName: escapeHtml(firstName || ''),
    resetUrl,
    ttlHours: config.security.passwordResetTtlHours,
  });
  const text = `Hola ${firstName},

Recibimos una solicitud para cambiar tu contraseña. Si fuiste tú, continúa aquí:

${resetUrl}

Si no solicitaste este cambio, ignora este mensaje.
— GEMMATEX`;
  return send({ to, subject: 'Restablecer contraseña · Gemmatex', html, text });
}

module.exports = {
  send,
  sendVerificationEmail,
  sendEmailChangeEmail,
  sendPasswordResetEmail,
  buildUrl,
};
