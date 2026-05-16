# SMTP y troubleshooting

Config de envío real de correos + qué hacer cuando algo falla.

## Config en `.env`

```
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USER=sistemas@gemmatex.com.bo
MAIL_PASSWORD=<password de la cuenta SMTP>
MAIL_FROM_NAME=GEMMATEX SSO
MAIL_FROM_EMAIL=sistemas@gemmatex.com.bo
```

⚠ **`MAIL_USER` debe ser el email completo**, no solo el alias. Hostinger rechaza el alias suelto.

⚠ **`MAIL_FROM_EMAIL` debe coincidir** con `MAIL_USER` o ser un alias válido configurado en Hostinger. De lo contrario el servidor rechaza con `550 Sender address not authorized`.

## Proveedores soportados

El SSO usa `nodemailer` que soporta cualquier SMTP estándar. Solo cambia los datos en `.env`.

| Proveedor | Host | Port | Secure |
|---|---|---|---|
| Hostinger | `smtp.hostinger.com` | 465 | true |
| Gmail | `smtp.gmail.com` | 587 | false (STARTTLS) |
| Outlook 365 | `smtp.office365.com` | 587 | false (STARTTLS) |
| SendGrid | `smtp.sendgrid.net` | 587 | false |
| Mailgun | `smtp.mailgun.org` | 587 | false |
| AWS SES | `email-smtp.<region>.amazonaws.com` | 587 | false |

Para Gmail necesitas **app password** (no la password normal de cuenta) y 2FA habilitado.

## Comportamiento en desarrollo

`NODE_ENV=development`:

1. **Antes** de intentar enviar, imprime en consola un resumen:
   ```
   ───── 📧 EMAIL (dev log) ──────────────────────────────
     To:      maria@test.bo
     Subject: Verifica tu correo · Gemmatex
     URLs:
       → http://localhost:2106/api/v1/auth/verify-email?token=...
   ───────────────────────────────────────────────────────
   ```
   Útil para testear sin SMTP funcional — copia el URL y úsala manualmente.

2. **Intenta** enviar via SMTP real.

3. **Si SMTP falla** (auth, network, etc.):
   - Log dev queda en consola (paso 1 ya impreso).
   - El error NO rompe el flujo del registro/cambio (el user ya está creado).
   - Mensaje `[mail] SMTP falló (xxx). Email mostrado arriba.`

En producción (`NODE_ENV=production`):
- NO se imprime dev log.
- Si SMTP falla → la operación tira excepción y se propaga.

## Comportamiento del envío

```
sendVerificationEmail({ to, firstName, token })
       │
       ▼
construir verifyUrl con EMAIL_VERIFY_URL_TEMPLATE
       │
       ▼
render('verify', { firstName, verifyUrl, ttlHours })
       │
       ▼
send({ to, subject, html, text })
       │
       ▼
[dev only] devLogEmail(...) → consola
       │
       ▼
nodemailer.sendMail(...)
       │
       ├── ok  → { ok: true, messageId }
       └── err → [dev] log + return { ok: false }
                 [prod] throw
```

## Verificar SMTP independientemente del SSO

Script standalone para diagnosticar:

```bash
node -e "
require('dotenv').config();
const nodemailer = require('nodemailer');

const t = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: process.env.MAIL_SECURE === 'true',
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
});

t.verify()
  .then(() => console.log('✓ SMTP OK'))
  .catch(err => console.error('✗', err.code, err.message));
"
```

Salida esperada: `✓ SMTP OK`.

## Errores comunes

### `535 5.7.8 Error: authentication failed`

Credenciales rechazadas.

Causas posibles:
1. `MAIL_PASSWORD` incorrecta.
2. `MAIL_USER` no es el email completo (usaste solo el alias).
3. Cuenta tiene 2FA activado y necesitas **app password** (Gmail).
4. La cuenta fue bloqueada por el proveedor.

Fix: verifica login manual via webmail de Hostinger. Si funciona ahí pero no SMTP → revisa app passwords / restricciones.

### `ECONNREFUSED` / `ETIMEDOUT`

No se pudo conectar al servidor SMTP.

Causas:
1. Host/puerto incorrectos.
2. Firewall local bloquea outbound 465 / 587.
3. ISP residencial bloquea SMTP (común con ISPs móviles).
4. El servidor SMTP del proveedor está caído.

Fix:
```bash
# Test desde shell
openssl s_client -connect smtp.hostinger.com:465 -servername smtp.hostinger.com
# Si no conecta → problema de red.
```

### `550 5.7.1 Sender address not authorized`

El proveedor rechaza el remitente.

Causa: `MAIL_FROM_EMAIL` no coincide con `MAIL_USER` y no está autorizado como alias.

Fix: pon `MAIL_FROM_EMAIL = MAIL_USER` o configura el alias en el panel del proveedor.

### Llega a spam

El email se envía pero cae en spam del destinatario.

Causas:
1. Falta SPF / DKIM / DMARC en el dominio.
2. Reputación baja del dominio remitente.
3. IP del servidor SMTP en lista negra (raro con Hostinger).
4. Contenido sospechoso (muchas URLs, mayúsculas, palabras tipo "promoción").

Fix:
- Pide a IT que configure SPF, DKIM, DMARC en DNS de `gemmatex.com.bo`.
- Test en [mail-tester.com](https://www.mail-tester.com) para score anti-spam.
- Usa lenguaje natural, evita ALL CAPS y exceso de exclamaciones.

### `Greeting never received`

Conectó pero el servidor no respondió en handshake.

Causa: `MAIL_SECURE` mal seteado. Si puerto 465 → `MAIL_SECURE=true`. Si 587 → `MAIL_SECURE=false` (usa STARTTLS).

### Templates llegan rotas (sin imagen, sin estilo)

- Imagen no carga: revisa que `MAIL_LOGO_URL` sea HTTPS, accesible públicamente, sin hotlink protection.
- Estilos no aplican: ya están inline, deberían funcionar. Si Gmail los strips, revisa que no haya tags `<style>` en `<head>`.

## SPF / DKIM / DMARC (DNS)

Para emails que NO caigan en spam, configura en DNS de `gemmatex.com.bo`:

### SPF

```
TXT @ "v=spf1 include:_spf.hostinger.com ~all"
```

### DKIM

Hostinger genera la clave en el panel. Añade el TXT que te indica.

### DMARC

```
TXT _dmarc "v=DMARC1; p=quarantine; rua=mailto:postmaster@gemmatex.com.bo"
```

Sin estos tres, Gmail / Outlook marcan los emails como sospechosos.

## Producción

⚠ Recomendaciones para deploy a producción:

1. **No uses Hostinger SMTP en producción si volumen >100 emails/día**. Provee mejores SLAs SendGrid / Mailgun / SES.
2. **Configura monitoring** del rate de envío (bounce rate, complaints).
3. **Pon retry queue** (Bull, BullMQ) si el envío falla — actualmente el SSO lo intenta una vez.
4. **Logs en archivo separado** — capturar messageId para auditar entregas.

## Cambiar de proveedor

Solo cambia las variables `.env`. No requiere tocar código. Reinicia el server.

```
MAIL_HOST=email-smtp.us-east-1.amazonaws.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=<SES SMTP user>
MAIL_PASSWORD=<SES SMTP password>
```
