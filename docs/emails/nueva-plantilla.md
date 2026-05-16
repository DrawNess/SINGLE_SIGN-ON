# Crear una plantilla nueva

Paso a paso para añadir un nuevo tipo de email (ej. "bienvenida tras verificación", "factura emitida", "alerta de seguridad").

## Caso ejemplo

Vamos a crear una plantilla **`welcome.html`** que se manda al cliente tras verificar exitosamente su correo.

## Paso 1 — Crear el archivo HTML

```bash
touch src/services/email/templates/welcome.html
```

Copia el contenido base desde `verify.html` y adáptalo. Estructura mínima:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Bienvenido | Gemmatex</title>
</head>
<body style="margin:0;padding:0;background:#f6f8fc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;">Bienvenido a Gemmatex.</div>

  <center style="width:100%;background:#f6f8fc;padding:28px 0;">
    <table role="presentation" width="620" style="max-width:620px;background:#fff;border-radius:16px;">
      <tr><td style="height:4px;background:{{brandColor}};"></td></tr>

      <tr>
        <td style="padding:22px;text-align:center;">
          <img src="{{logoUrl}}" width="170" alt="Gemmatex">
        </td>
      </tr>

      <tr>
        <td style="padding:0 22px 18px 22px;">
          <h1 style="margin:0 0 10px 0;font-size:20px;">¡Bienvenido!</h1>
          <p style="font-size:14px;color:#334155;">
            Hola {{firstName}}, tu cuenta está activa. Ya puedes acceder a todos nuestros servicios.
          </p>
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="border-radius:12px;background:{{brandColor}};">
                <a href="{{loginUrl}}"
                   style="display:inline-block;padding:12px 16px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:12px;">
                  Iniciar sesión
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:14px 22px 18px 22px;font-size:12px;color:#94a3b8;">
          &copy; {{year}} Gemmatex S.R.L. {{location}}
        </td>
      </tr>
    </table>
  </center>
</body>
</html>
```

Usa los placeholders `{{firstName}}`, `{{loginUrl}}` (los nuevos) + globales `{{brandColor}}`, `{{logoUrl}}`, `{{year}}`, `{{location}}`.

## Paso 2 — Helper en `email.service.js`

Abre `src/services/email.service.js` y añade:

```js
async function sendWelcomeEmail({ to, firstName, loginUrl }) {
  const html = render('welcome', {
    firstName: escapeHtml(firstName || ''),
    loginUrl,
  });
  const text = `Hola ${firstName}, tu cuenta Gemmatex está activa.

Inicia sesión: ${loginUrl}

— GEMMATEX`;
  return send({ to, subject: 'Bienvenido · Gemmatex', html, text });
}

module.exports = {
  // ... exports existentes
  sendWelcomeEmail,
};
```

## Paso 3 — Llamarlo desde donde aplique

En `verification.service.js`, dentro de `consumeToken` cuando es `mode='registration'`, después del COMMIT:

```js
const emailService = require('./email.service');

// ... tras await t.commit();

if (mode === 'registration') {
  await emailService.sendWelcomeEmail({
    to: user.email,
    firstName: await getFirstName(user.id),
    loginUrl: `${config.app.url}/login`,  // o tu frontend URL
  });
}
```

## Paso 4 — Configurar URL si aplica

Si el email contiene una URL externa (ej. tu frontend de login), añade env var:

`.env.example`:
```
LOGIN_URL=https://app.gemmatex.com.bo/login
```

`src/config/env.js`:
```js
LOGIN_URL: Joi.string().uri().default('http://localhost:3000/login'),
// ...
app: {
  // ...
  loginUrl: value.LOGIN_URL,
},
```

Y usa `config.app.loginUrl` en lugar de hardcoded.

## Paso 5 — Test

```bash
# Genera preview
node -e "
const { render } = require('./src/services/email/render');
const fs = require('fs');
const html = render('welcome', {
  firstName: 'Maria',
  loginUrl: 'https://app.gemmatex.com.bo/login',
});
fs.writeFileSync('/tmp/welcome.html', html);
console.log('Preview en /tmp/welcome.html');
"
xdg-open /tmp/welcome.html
```

Verifica:
- Logo carga
- Color de marca correcto
- Botón clickeable
- No quedan placeholders sin reemplazar (no se ven `{{...}}` literales)

## Paso 6 — Actualizar docs

Edita:

- `docs/emails/placeholders.md` → añade sección **`welcome.html`** con sus placeholders.
- `docs/emails/README.md` → añade la nueva plantilla al listado.

## Recordatorio: escape HTML

Cualquier dato del usuario que vaya en una plantilla debe pasarse por `escapeHtml()`:

```js
firstName: escapeHtml(user.firstName),
newEmail: escapeHtml(user.newEmail),
```

Para URLs y valores controlados por backend, no necesario.

## Checklist final

- [ ] `.html` creado en `src/services/email/templates/`
- [ ] Helper `sendXxxEmail` en `email.service.js`
- [ ] Llamada desde el service correspondiente
- [ ] Placeholders documentados en `docs/emails/placeholders.md`
- [ ] Preview verificado en navegador
- [ ] Test de envío real a un inbox
- [ ] Variables nuevas de `.env` añadidas a `.env.example`
