# Plantillas HTML

Cada email del SSO usa una plantilla HTML separada con placeholders `{{var}}`.

## Ubicación

```
src/services/email/templates/
├── verify.html                       Verificación de correo (registro)
├── change.html                       Confirmación de cambio de correo
├── reset.html                        Reset de contraseña
├── invitation.html                   Invitación a staff
├── security-theft.html               Alerta: theft detected
└── security-password-changed.html    Alerta: password cambiado
```

## Diseño común

Todas las plantillas siguen la misma estructura branded Gemmatex:

```
┌────────────────────────────────────────────────────┐
│  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌  ← top bar    │
│                                                    │
│              [LOGO GEMMATEX]                       │
│                                                    │
│        TÍTULO PEQUEÑO EN MAYÚSCULAS               │
│                                                    │
│   Heading del email                                │
│                                                    │
│   Hola {{firstName}},                             │
│                                                    │
│   Párrafo introductorio explicando la acción.     │
│                                                    │
│   ┌─────────────────────────────┐                  │
│   │   BOTÓN CTA AZUL            │                  │
│   └─────────────────────────────┘                  │
│                                                    │
│   Si el botón no funciona, abre este enlace:      │
│   https://...                                      │
│                                                    │
│   ─────────────────────────────                    │
│   Nota de pie (expira en X horas, etc.)           │
│   © 2026 Gemmatex S.R.L. La Paz - Bolivia         │
└────────────────────────────────────────────────────┘
```

## Stack técnico de los HTML

- **Layout con `<table>`** (no flexbox/grid). Razón: clientes de email (Outlook, Gmail, Apple Mail) tienen soporte CSS pobre. Las tablas garantizan render consistente.
- **Estilos inline** (`style="..."`). Muchos clientes ignoran `<style>` en `<head>`. Inline = único safe.
- **Ancho fijo 620px máximo**. Con `max-width` para móvil.
- **`<meta name="viewport">`** para móvil.
- **Preheader oculto** (`display:none`) — texto preview que aparece en la inbox antes de abrir.

## Cómo se renderiza

```js
const { render } = require('./src/services/email/render');

const html = render('verify', {
  firstName: 'Maria',
  verifyUrl: 'https://...?token=...',
  ttlHours: 24,
});
```

Pasos internos del `render(name, vars)`:

1. Carga `src/services/email/templates/${name}.html` (cache en prod, sin cache en dev).
2. Inyecta variables globales auto: `logoUrl`, `brandColor`, `location`, `year`.
3. Reemplaza cada `{{nombre}}` por el valor en `vars[nombre]`.
4. Si un placeholder no tiene valor → se reemplaza por `''` (string vacío, no rompe).

## Sustitución regex

```js
html.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
```

Soporta solo `{{nombre}}` simple. No condicionales `{{#if}}`, no loops, no escapes complejos. Por diseño: simplicidad sobre potencia.

## Escape HTML

`render.js` **NO escapa** automáticamente. Razón: muchos placeholders son URLs o HTML legítimo. El que llama controla.

Convención: si un campo viene del usuario (nombre, email), pasarlo por `escapeHtml()`:

```js
const { render, escapeHtml } = require('./src/services/email/render');

render('verify', {
  firstName: escapeHtml(user.firstName),   // ← escape porque viene del user
  verifyUrl: buildUrl(template, token),    // ← URL controlada, no escape
});
```

## Editar el HTML

Sigue [editar.md](./editar.md).

## Añadir una plantilla nueva

Sigue [nueva-plantilla.md](./nueva-plantilla.md).
