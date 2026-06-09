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

async function sendInvitationEmail({ to, inviterName, roleName, token }) {
  const invitationUrl = buildUrl(config.mail.invitationUrlTemplate, token);
  const html = render('invitation', {
    inviterName: escapeHtml(inviterName || 'Un administrador'),
    roleName: escapeHtml(roleName),
    invitationUrl,
    ttlDays: config.security.adminInviteTtlDays,
  });
  const text = `Hola,

${inviterName || 'Un administrador'} te invitó a Gemmatex con el rol ${roleName}.

Acepta la invitación aquí:
${invitationUrl}

Este enlace expira en ${config.security.adminInviteTtlDays} días.

— GEMMATEX`;
  return send({ to, subject: 'Invitación al equipo · Gemmatex', html, text });
}

/**
 * Notifica al usuario que se detectó robo de su refresh token y todas sus
 * sesiones fueron revocadas. Best effort — no debe romper flujo si falla.
 */
async function sendSecurityTheftEmail({ to, firstName, ip, userAgent, when }) {
  const resetUrl = buildUrl(
    config.mail.resetUrlTemplate.replace('?token={token}', ''),
    ''
  );
  const sessionsUrl = resetUrl.replace('/reset-password', '/sessions');
  const html = render('security-theft', {
    firstName: escapeHtml(firstName || ''),
    ip: escapeHtml(ip || 'desconocida'),
    userAgent: escapeHtml(userAgent || 'desconocido'),
    when: escapeHtml(when || new Date().toISOString()),
    resetUrl,
    sessionsUrl,
  });
  const text = `Hola ${firstName},

Detectamos actividad sospechosa en tu cuenta Gemmatex.
Alguien intentó usar una sesión ya rotada. Cerramos todas tus sesiones.

Fecha: ${when}
IP: ${ip}
Dispositivo: ${userAgent}

Cambia tu contraseña: ${resetUrl}
Ver tus sesiones: ${sessionsUrl}

Si fuiste tú, ignora este mensaje.
— GEMMATEX`;
  return send({ to, subject: '⚠ Actividad sospechosa en tu cuenta · Gemmatex', html, text });
}

/**
 * Notifica al usuario que su contraseña fue cambiada.
 */
async function sendPasswordChangedEmail({ to, firstName, ip, userAgent, when }) {
  const resetUrl = buildUrl(
    config.mail.resetUrlTemplate.replace('?token={token}', ''),
    ''
  );
  const html = render('security-password-changed', {
    firstName: escapeHtml(firstName || ''),
    ip: escapeHtml(ip || 'desconocida'),
    userAgent: escapeHtml(userAgent || 'desconocido'),
    when: escapeHtml(when || new Date().toISOString()),
    resetUrl,
  });
  const text = `Hola ${firstName},

Tu contraseña Gemmatex fue cambiada exitosamente.

Cuándo: ${when}
IP: ${ip}
Dispositivo: ${userAgent}

Cerramos todas tus sesiones por seguridad.

Si NO fuiste tú, recupera tu cuenta: ${resetUrl}

— GEMMATEX`;
  return send({ to, subject: 'Tu contraseña fue cambiada · Gemmatex', html, text });
}

/**
 * Email único para usuarios migrados desde sistemas previos.
 * Combina bienvenida + acción de fijar contraseña.
 * Usa el token de password_reset existente (mismo endpoint /auth/reset-password).
 * El TTL es más largo (24h vs 1h del reset normal) — el script de migración
 * inserta el password_reset con expires_at ampliado.
 */
async function sendMigrationWelcomeEmail({ to, firstName, token, ttlHours = 24 }) {
  const resetUrl = buildUrl(config.mail.resetUrlTemplate, token);
  const html = render('migration-welcome', {
    firstName: escapeHtml(firstName || ''),
    resetUrl,
    ttlHours,
  });
  const text = `Hola ${firstName},

En GEMMATEX estamos renovando la plataforma para sumar nuevas
funcionalidades: historial de pedidos mejorado, notificaciones, y un
perfil unificado para todos nuestros servicios.

Para que disfrutes la nueva experiencia, solo necesitamos que elijas
una contraseña nueva. Las anteriores no migran por motivos técnicos
de la actualización.

Crear tu contraseña: ${resetUrl}

Este enlace expira en ${ttlHours} horas. Si recibiste este correo por
error, ignoralo.

— Equipo GEMMATEX`;
  return send({ to, subject: 'Estrenamos GEMMATEX · Completa tu cuenta', html, text });
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
  sendMigrationWelcomeEmail,
  sendInvitationEmail,
  sendSecurityTheftEmail,
  sendPasswordChangedEmail,
  buildUrl,
};
