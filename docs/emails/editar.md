# Editar plantillas

Cómo modificar el diseño / copy de los emails.

## Edición en desarrollo (con hot reload)

1. Asegúrate `NODE_ENV=development` en `.env` (default).
2. Abre `src/services/email/templates/verify.html` (o la que quieras editar) en tu editor.
3. Modifica HTML / texto / estilos.
4. Guarda.
5. **Próximo envío** usa la versión actualizada — **sin reiniciar el server**.

Razón: en dev, `render.js` lee el archivo desde disco en cada `render()`. Sin cache.

## Edición en producción (con cache)

En `NODE_ENV=production`, el HTML se cachea en memoria al primer uso por performance. Tras editar:

```bash
# Opción A — reinicia el servicio (recomendada)
pm2 restart sso
# o
systemctl restart sso

# Opción B — fuerza limpiar cache vía endpoint admin (futuro, no implementado)
```

## Preview rápido durante edición

Genera previews de los 3 templates con datos demo:

```bash
node -e "
const { render } = require('./src/services/email/render');
const fs = require('fs');
fs.writeFileSync('/tmp/verify.html', render('verify', {
  firstName: 'Tu Nombre',
  verifyUrl: 'https://example.com/verify?token=DEMO',
  ttlHours: 24,
}));
fs.writeFileSync('/tmp/change.html', render('change', {
  firstName: 'Tu Nombre',
  newEmail: 'nuevo@correo.com',
  confirmUrl: 'https://example.com/confirm?token=DEMO',
  ttlHours: 24,
}));
fs.writeFileSync('/tmp/reset.html', render('reset', {
  firstName: 'Tu Nombre',
  resetUrl: 'https://example.com/reset?token=DEMO',
  ttlHours: 1,
}));
console.log('Previews en /tmp/{verify,change,reset}.html');
"

# Abre en browser
xdg-open /tmp/verify.html
```

## Test de envío real a tu inbox

```bash
curl -X POST http://localhost:2106/api/v1/auth/resend-verification \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@email.com"}'
```

Solo funciona si tu user está en `pending`. Si no, crea uno nuevo o usa otro flujo (cambio email, etc.).

## Qué se puede cambiar libremente

- Texto / copy
- Colores (pero mejor cambia `MAIL_BRAND_COLOR` en `.env` — afecta todas plantillas)
- Layout interno
- Tamaños de fuente
- Padding / margin
- Imágenes adicionales

## Qué evitar

- ❌ Tags `<style>` en `<head>` (Gmail los strips). Usa **estilos inline** siempre.
- ❌ CSS moderno: `flex`, `grid`, `var()`, custom properties. Soporte limitado.
- ❌ Fuentes externas (`@import` desde Google Fonts). Algunos clientes bloquean.
- ❌ JavaScript. **Todos** los clientes lo bloquean.
- ❌ `<form>`. Algunos clientes los muestran pero no envían — confunde al user.
- ❌ Background images en `<body>`. Outlook ignora.

## Si rompes algo

1. `git diff src/services/email/templates/` muestra qué cambiaste.
2. `git checkout -- src/services/email/templates/verify.html` revierte ese archivo.
3. Si nada funciona: regenera desde el repo original o pídelo a otro dev.

## Variables globales vs locales

| Cambio | Dónde |
|---|---|
| Logo nuevo | `.env` → `MAIL_LOGO_URL` |
| Color de marca distinto | `.env` → `MAIL_BRAND_COLOR` |
| Footer location | `.env` → `MAIL_FOOTER_LOCATION` |
| Wording del kicker / heading / botón | HTML del template |
| Estructura del layout | HTML del template |

Cambios en `.env` requieren reiniciar el server (variables solo se leen al boot).
Cambios en HTML toman efecto inmediato en dev, requieren restart en prod.

## Validar email real (anti-spam)

Tras editar, manda un email a un test inbox y revisa con:

- [mail-tester.com](https://www.mail-tester.com) — score anti-spam
- Gmail spam folder — si llega ahí, hay problemas de SPF/DKIM/DMARC
- Imagen del logo carga? Si no, hay problema de hosting / CORS / hotlink

## Cliente preview en VS Code

Extensiones recomendadas:

- `Live Preview` (Microsoft) — preview HTML inline.
- `Prettier` — formatear HTML automáticamente.

Abre el `.html` y `Ctrl+Shift+V` para preview.
