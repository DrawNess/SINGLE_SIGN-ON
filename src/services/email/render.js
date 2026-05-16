'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config/env');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Cache de plantillas leídas del disco. En dev se recarga en cada render
// para permitir editar HTML sin reiniciar el servidor (hot reload).
const cache = new Map();

function readTemplate(name) {
  const file = path.join(TEMPLATES_DIR, `${name}.html`);
  if (config.isDev) {
    return fs.readFileSync(file, 'utf8');
  }
  if (!cache.has(name)) {
    cache.set(name, fs.readFileSync(file, 'utf8'));
  }
  return cache.get(name);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renderiza una plantilla HTML reemplazando placeholders `{{var}}`
 * con los valores proporcionados.
 *
 * Variables globales auto-inyectadas (de `config.mail`):
 *   - logoUrl
 *   - brandColor
 *   - location
 *   - year
 *
 * Variables sensibles (URLs, nombres) NO se escapan — la plantilla
 * controla su uso. El render solo hace string replacement directo.
 */
function render(templateName, vars = {}) {
  const html = readTemplate(templateName);
  const allVars = {
    logoUrl: config.mail.logoUrl,
    brandColor: config.mail.brandColor,
    location: config.mail.footerLocation,
    year: new Date().getFullYear(),
    ...vars,
  };
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return allVars[key] !== undefined ? String(allVars[key]) : '';
  });
}

function clearCache() {
  cache.clear();
}

module.exports = { render, clearCache, escapeHtml, TEMPLATES_DIR };
