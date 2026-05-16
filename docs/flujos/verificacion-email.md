# Flujo — Verificación de email

> Para detalle de plantillas HTML, placeholders y SMTP, ver [docs/emails/](../emails/README.md).


## Registro con verificación obligatoria

Tras registrarse, el usuario queda `status='pending'`. NO puede loguear hasta verificar.

```
Cliente             SSO              Postgres            Mail server
   │                 │                  │                    │
   │ POST /register  │                  │                    │
   │ ─────────────►  │                  │                    │
   │                 │ TX:              │                    │
   │                 │  INSERT user     │                    │
   │                 │  status=pending  │                    │
   │                 │ ──────────────►  │                    │
   │                 │  INSERT profile  │                    │
   │                 │ ──────────────►  │                    │
   │                 │  INSERT role     │                    │
   │                 │ ──────────────►  │                    │
   │                 │  INSERT          │                    │
   │                 │  email_verif     │                    │
   │                 │  token random    │                    │
   │                 │  sha256(token)   │                    │
   │                 │ ──────────────►  │                    │
   │                 │ COMMIT           │                    │
   │                 │                  │                    │
   │                 │ sendVerification │                    │
   │                 │ Email(token)     │                    │
   │                 │ ─────────────────────────────────►   │
   │                 │ ◄─────────────────────────────────   │
   │                 │ (envío best effort, no rompe registro)
   │                 │                  │                    │
   │ 201 user        │                  │                    │
   │ ◄──────────────│                  │                    │
   │   (sin tokens)  │                  │                    │
```

Si el envío de email falla, el registro queda OK pero el usuario debe llamar `/resend-verification` luego.

## Login bloqueado mientras pending

```
Cliente             SSO
   │                 │
   │ POST /login     │
   │ ─────────────►  │
   │                 │ findOne email
   │                 │ Argon2 password OK
   │                 │ status === 'pending' ?
   │                 │   → 403 AccountPending
   │ 403 ───────────│
```

## Click en el email

El usuario recibe el correo con un link al **frontend portal**:
```
https://account.gemmatex.com.bo/verify-email?token=W0VK8B-mKwRZucT...
```
(URL configurada via `EMAIL_VERIFY_URL_TEMPLATE`)

El frontend `account.gemmatex.com.bo` (Universal Login pattern, estilo Samsung/Google):

1. Extrae `?token=` del query
2. Muestra spinner "Verificando..."
3. Llama al SSO API:
   ```
   POST https://sso.gemmatex.com.bo/api/v1/auth/verify-email
   Body: { "token": "W0VK8B-mKwRZucT..." }
   ```
4. Muestra "✓ Cuenta activada" + redirige a `/login`

Detalle completo en [docs/emails/frontend-integration.md](../emails/frontend-integration.md).

### Workaround para dev sin frontend

Si aún no tienes el frontend portal:
- Default `.env` apunta a `http://localhost:3000` (asume Vite dev en otro repo).
- O override temporal en `.env`:
  ```
  EMAIL_VERIFY_URL_TEMPLATE=http://localhost:2106/api/v1/auth/verify-email?token={token}
  ```
  → link del email pega directo a la API (GET funciona). Solo dev.

## Servicio consume el token

```
GET /api/v1/auth/verify-email?token=W0VK8B...
              ↓
  sha256(token) → busca en email_verifications
              ↓
  ¿existe? ¿used_at NULL? ¿expires_at > now?
              ↓
  TX:
    UPDATE email_verifications SET used_at = now
    UPDATE users SET email_verified_at = now, status = 'active'
              ↓
  audit_log action='auth.email_verified'
              ↓
  200 { message, mode: 'registration' }
```

## Cambio de email

Para cambiar el email un usuario ya logueado:

```
1. POST /api/v1/auth/change-email
   Headers: Authorization: Bearer <access>
   Body: { new_email, current_password }

2. SSO:
   - Verifica password con Argon2
   - Verifica que new_email no esté en uso
   - Crea email_verifications con email=new_email + new_email=new_email
   - Envía email AL NUEVO destino (no al actual)
   - audit: 'auth.email_change.requested'
   - 200 { message }

3. Usuario hace click en el email recibido en la NUEVA dirección:
   GET /api/v1/auth/confirm-email-change?token=...

4. SSO:
   - Valida token (mismo flujo que verify-email)
   - Detecta new_email NOT NULL → modo email_change
   - TX:
       UPDATE users SET email = new_email, email_verified_at = now
       UPDATE refresh_tokens SET revoked_at = now (TODOS)
       UPDATE email_verifications SET used_at = now
   - audit: 'auth.email_changed'
   - 200 { message, mode: 'email_change' }

5. Usuario debe re-loguear (refresh tokens revocados).
```

### Por qué enviar al nuevo email (no al actual)

Si enviamos al **actual**, el atacante que ya está autenticado puede cambiar el email a uno suyo sin que el dueño se entere. Si enviamos al **nuevo**, el atacante debe controlar el nuevo email — eso es lo que estamos verificando.

Bonus: protege contra cambios accidentales (typo). Si el dueño legítimo escribe mal el email, no recibe la confirmación → cambio no se completa.

## Resend verification

```
POST /api/v1/auth/resend-verification
{ "email": "maria.lopez@test.bo" }
```

Comportamiento:
- Si email NO existe → 200 silencioso (anti-enumeración).
- Si email existe pero ya verificado → 200 silencioso.
- Si email existe y pendiente:
  - Marca todos los tokens previos como `used_at = now` (anti-replay).
  - Genera token nuevo.
  - Envía email.
  - audit: `auth.email_verification.resent`.

Cliente recibe la misma respuesta en todos los casos: "Si el correo está registrado y pendiente, recibirás un nuevo email."

## Anti-enumeración aplicada

| Endpoint | Respuesta si email no existe |
|---|---|
| `/auth/login` | 401 InvalidCredentials genérico |
| `/auth/resend-verification` | 200 silencioso |
| `/auth/forgot-password` (futuro) | 200 silencioso |
| `/auth/register` con email tomado | 409 EmailInUse (es necesario) |

Solo `register` revela info, porque es la única forma de saber si un email registra. Aceptable.

## Configuración

`.env`:
```
EMAIL_VERIFY_TTL_HOURS=24
EMAIL_VERIFY_URL_TEMPLATE=http://localhost:3000/verify-email?token={token}
EMAIL_CHANGE_URL_TEMPLATE=http://localhost:3000/confirm-email?token={token}
```

Placeholder `{token}` reemplazado por el token plano antes de enviar.

## Tabla `email_verifications`

| Columna | Notas |
|---|---|
| `user_id` | FK users CASCADE |
| `token_hash` | SHA-256 hex del token (NUNCA en plano) |
| `email` | Email actual al que se manda |
| `new_email` | Solo si flujo de cambio. NULL en registro. |
| `expires_at` | NOW + TTL |
| `used_at` | NULL hasta consumir |

Una sola tabla cubre los 2 flujos: registro y cambio. Distinción por `new_email IS NOT NULL`.

## En dev sin SMTP

Si `MAIL_USER` / `MAIL_PASSWORD` están vacíos o el servidor SMTP no responde:
- El SSO imprime en consola el subject + URLs del email.
- Puedes copiar la URL y pegarla en el navegador para verificar.
- Útil para test sin necesidad de SMTP real.

En producción, sin SMTP funcional, el registro queda OK pero el usuario NO recibe el email → bloqueado. Garantiza que SMTP funcione antes de desplegar.

## Ver también

- [docs/emails/](../emails/README.md) — Sistema de plantillas HTML editables
- [docs/emails/editar.md](../emails/editar.md) — Cómo modificar el copy/diseño del email
- [docs/emails/smtp.md](../emails/smtp.md) — Troubleshooting de envío
