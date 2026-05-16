# Placeholders disponibles

Variables que puedes usar en los archivos `.html` con sintaxis `{{nombre}}`.

## Globales (auto-inyectados desde `.env`)

Disponibles en **todas** las plantillas sin pasarlos explícitamente:

| Placeholder | Valor | Origen |
|---|---|---|
| `{{logoUrl}}` | URL del logo Gemmatex | `MAIL_LOGO_URL` |
| `{{brandColor}}` | Color hex de marca | `MAIL_BRAND_COLOR` (default `#0b5ed7`) |
| `{{location}}` | Texto pie corporativo | `MAIL_FOOTER_LOCATION` (default `La Paz – Bolivia`) |
| `{{year}}` | Año actual | calculado: `new Date().getFullYear()` |

## Por plantilla

### `verify.html` — verificación de correo (registro)

| Placeholder | Tipo | Notas |
|---|---|---|
| `{{firstName}}` | string | Primer nombre del cliente (escapeHtml aplicado) |
| `{{verifyUrl}}` | URL | Link de verificación con `?token=...` |
| `{{ttlHours}}` | number | Horas hasta expirar (default 24) |

### `change.html` — cambio de correo

| Placeholder | Tipo | Notas |
|---|---|---|
| `{{firstName}}` | string | Primer nombre |
| `{{newEmail}}` | string | Nuevo email (escapeHtml aplicado) |
| `{{confirmUrl}}` | URL | Link de confirmación |
| `{{ttlHours}}` | number | Horas hasta expirar |

### `reset.html` — reset de contraseña (paso 3D)

| Placeholder | Tipo | Notas |
|---|---|---|
| `{{firstName}}` | string | Primer nombre |
| `{{resetUrl}}` | URL | Link de cambio password |
| `{{ttlHours}}` | number | Horas hasta expirar (default 1) |

## Qué pasa si un placeholder no tiene valor

Se reemplaza por **string vacío**. No rompe el render. Ejemplo:

```html
<p>Hola {{firstName}},</p>
```

Si `firstName` no se pasa o es `undefined` → resulta en `<p>Hola ,</p>`.

**Recomendación**: siempre pasa todos los placeholders del template. Si quieres un fallback "Hola amigo," cuando no haya nombre, hazlo en JS antes de llamar a `render`:

```js
const firstName = user.firstName || 'amigo';
const html = render('verify', { firstName, verifyUrl, ttlHours });
```

## Añadir un nuevo placeholder

1. Pon `{{miVariable}}` donde lo necesites en el `.html`.
2. En `email.service.js` (helper correspondiente) pasa `miVariable: valor` al objeto del `render()`.

Ejemplo añadir teléfono de soporte al pie:

**1. Edita `verify.html`**:
```html
<p style="...">
  Soporte: <a href="tel:{{supportPhone}}">{{supportPhone}}</a>
</p>
```

**2. Edita `email.service.js` (función `sendVerificationEmail`)**:
```js
const html = render('verify', {
  firstName: escapeHtml(firstName || ''),
  verifyUrl,
  ttlHours: config.security.emailVerifyTtlHours,
  supportPhone: '+591 700 00000',   // ← nuevo
});
```

Alternativa (mejor): pasar via `.env`:
```js
// 1. env.js: añade MAIL_SUPPORT_PHONE
// 2. render.js: inyectar en globales si quieres que esté en TODAS plantillas
```

## Convención de naming

- camelCase: `{{verifyUrl}}`, `{{firstName}}`, `{{newEmail}}`.
- No snake_case (sería raro mezclar estilos JS y HTML).
- Nombres descriptivos. Evita `{{x}}`, `{{tmp}}`.
