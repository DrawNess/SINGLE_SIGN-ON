# Emails del SSO GEMMATEX

Sistema de envío de emails con plantillas HTML editables, branded Gemmatex.

## Mapa de archivos

| Documento | Contenido |
|---|---|
| [Plantillas HTML](./plantillas.md) | Estructura de archivos, ubicación, formato |
| [Placeholders](./placeholders.md) | Variables disponibles por plantilla |
| [Editar / hot reload](./editar.md) | Cómo modificar HTML en dev y prod |
| [Crear nueva plantilla](./nueva-plantilla.md) | Paso a paso para añadir un email tipo |
| [SMTP y troubleshooting](./smtp.md) | Config Hostinger, fallback dev, errores comunes |
| [Integración con frontend](./frontend-integration.md) | Cómo `account.gemmatex.com.bo` consume los links |

## Resumen rápido

- 6 plantillas activas: `verify.html`, `change.html`, `reset.html`, `invitation.html`, `security-theft.html`, `security-password-changed.html`.
- Todas branded: logo Gemmatex + color corporativo + footer.
- Editas el HTML → cambio se aplica sin tocar JS.
- En dev: hot reload (sin restart server).
- En prod: cacheado en memoria al primer uso.
- Variables globales (`logoUrl`, `brandColor`, `location`) salen de `.env`.
- **Los links de email apuntan al frontend `account.gemmatex.com.bo`**, NO al API. Ver [frontend-integration.md](./frontend-integration.md).

## Stack

| Componente | Lib |
|---|---|
| Transporte SMTP | `nodemailer` |
| Render plantillas | sustitución `{{var}}` casera (sin engine externo) |
| Cache en memoria | `Map` simple |

Sin Handlebars / EJS / MJML para mantener cero dependencias extras y máximo control.

## Carpetas

```
src/services/email/
├── render.js                          carga + reemplazo {{var}}
└── templates/
    ├── verify.html                    registro
    ├── change.html                    cambio de correo
    ├── reset.html                     reset password
    ├── invitation.html                invitación staff
    ├── security-theft.html            alerta theft detected
    └── security-password-changed.html alerta password cambiado

src/services/email.service.js
                            send() + helpers de plantilla específicos
```

## Flujos que usan emails

| Acción | Plantilla | Doc del flujo |
|---|---|---|
| Registro | `verify.html` | [flujos/verificacion-email.md](../flujos/verificacion-email.md) |
| Cambio de email | `change.html` | [flujos/verificacion-email.md](../flujos/verificacion-email.md) |
| Reset password | `reset.html` | [flujos/password.md](../flujos/password.md) |
| Invitación staff | `invitation.html` | [api/admin.md](../api/admin.md) |
| Alerta theft detected | `security-theft.html` | [arquitectura/seguridad.md](../arquitectura/seguridad.md) |
| Alerta password cambiado | `security-password-changed.html` | [arquitectura/seguridad.md](../arquitectura/seguridad.md) |

## Configuración `.env` relacionada

```
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USER=sistemas@gemmatex.com.bo
MAIL_PASSWORD=...
MAIL_FROM_NAME=GEMMATEX SSO
MAIL_FROM_EMAIL=sistemas@gemmatex.com.bo
MAIL_LOGO_URL=https://...
MAIL_BRAND_COLOR=#0b5ed7
MAIL_FOOTER_LOCATION=La Paz – Bolivia

# Frontend portal (Universal Login estilo Samsung/Google)
EMAIL_VERIFY_URL_TEMPLATE=https://account.gemmatex.com.bo/verify-email?token={token}
EMAIL_CHANGE_URL_TEMPLATE=https://account.gemmatex.com.bo/confirm-email-change?token={token}
EMAIL_RESET_URL_TEMPLATE=https://account.gemmatex.com.bo/reset-password?token={token}

EMAIL_VERIFY_TTL_HOURS=24
PASSWORD_RESET_TTL_HOURS=1
```

En dev sin frontend, defaults apuntan a `http://localhost:3000` (Vite estándar).

Detalle SMTP en [smtp.md](./smtp.md). Detalle frontend en [frontend-integration.md](./frontend-integration.md).
