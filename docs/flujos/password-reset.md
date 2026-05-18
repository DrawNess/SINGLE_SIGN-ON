# Flujo — Reset y cambio de contraseña

Cómo el SSO maneja `forgot-password`, `reset-password` y `change-password`.

## 1. Forgot password (anti-enumeración)

```
Cliente              SSO              Postgres            Mail server
   │                  │                  │                    │
   │ POST /api/v1/auth/forgot-password   │                    │
   │ { email }                            │                    │
   │ ─────────────►   │                  │                    │
   │                  │                  │                    │
   │                  │ findOne(email)   │                    │
   │                  │ ──────────────►  │                    │
   │                  │                  │                    │
   │                  │ ¿user existe Y   │                    │
   │                  │  status != deleted? │                  │
   │                  │                  │                    │
   │                  │ Sí:              │                    │
   │                  │   invalida tokens previos             │
   │                  │   genera token random + sha256        │
   │                  │   INSERT password_resets              │
   │                  │   ──────────────►│                    │
   │                  │   sendPasswordResetEmail              │
   │                  │   ────────────────────────────────►   │
   │                  │   audit reset_requested               │
   │                  │                  │                    │
   │                  │ No: silencio                          │
   │                  │                  │                    │
   │ 200 (siempre)    │                  │                    │
   │ ◄──────────────  │                  │                    │
```

Mensaje genérico **siempre**:
```json
{ "message": "Si el correo está registrado, recibirás un email para restablecer tu contraseña." }
```

Atacante no puede enumerar emails registrados.

## 2. Reset password (consume token)

```
Cliente              SSO              Postgres
   │                  │                  │
   │ POST /api/v1/auth/reset-password    │
   │ { token, new_password }              │
   │ ─────────────►   │                  │
   │                  │                  │
   │                  │ sha256(token)    │
   │                  │ ──────────────►  │
   │                  │                  │
   │                  │ ¿existe?         │
   │                  │ ¿used_at NULL?   │
   │                  │ ¿expires_at>now?│
   │                  │                  │
   │                  │ Validar password contra:               │
   │                  │   - actual (user.password_hash)        │
   │                  │   - últimas N en password_history      │
   │                  │ Si match → 400 PasswordReused         │
   │                  │                  │
   │                  │ TRANSACTION ▼    │
   │                  │   INSERT password_history (viejo)     │
   │                  │   ──────────────►│                    │
   │                  │   trim history > N                    │
   │                  │   UPDATE user.password_hash = Argon2(new) │
   │                  │   password_changed_at = now           │
   │                  │   failed_attempts = 0                 │
   │                  │   locked_until = null                 │
   │                  │   ──────────────►│                    │
   │                  │   UPDATE password_resets.used_at      │
   │                  │   ──────────────►│                    │
   │                  │   UPDATE refresh_tokens                │
   │                  │     revoked_at = now                   │
   │                  │     revoked_reason = password_changed │
   │                  │   ──────────────►│                    │
   │                  │ COMMIT           │                    │
   │                  │                  │                    │
   │                  │ audit reset_completed                 │
   │                  │                  │                    │
   │ 200 message      │                  │                    │
   │ ◄──────────────  │                  │                    │
```

## 3. Change password (autenticado)

Mismo flujo que reset, con 2 diferencias:

1. **Requiere `current_password`** — verificación con Argon2 antes de proceder.
2. **No usa token** — la autenticación viene del Bearer JWT en el header.

Resto idéntico:
- Anti-reuse contra history.
- Hash nuevo.
- Revoca todos los refresh tokens.

## Política anti-reuso

Configurable en `.env`:
```
PASSWORD_HISTORY_SIZE=5
```

Lógica de validación:
```
Para nueva password N:
  if Argon2.verify(N, user.password_hash) → 400 (es la actual)
  for cada hash en password_history (orden DESC, limit N):
    if Argon2.verify(N, hash) → 400 (es una pasada)
  OK → procede
```

Mensaje: "No puedes reusar una de tus últimas 6 contraseñas" (5 history + 1 actual = 6).

## ¿Por qué revocar todos los refresh tokens?

Si la víctima ha sido comprometida (atacante conoce/cambia password), revocar todos los refresh tokens activos asegura:

- Atacante que ya tiene refresh no puede emitir más access tokens.
- Víctima debe re-loguear → SSO confirma su identidad de nuevo.
- Si el atacante intenta usar refresh viejo → 401 (revocado).

`revoked_reason='password_changed'` deja audit trail claro.

## ¿Y el access token actual?

⚠ JWT access token **no** se invalida — sigue válido hasta `exp` (15 min default).

Razón: invalidar JWT requiere blacklist en Redis/DB (rompe stateless). Aceptamos ventana corta.

Mitigación: TTL corto (15 min). Para invalidación inmediata real, implementar:
- Lista negra con `jti` (JWT ID) en Redis.
- Middleware checa Redis en cada request.

No implementado MVP por performance + complejidad.

## Casos especiales

### Reset con cuenta `pending`

Si user está pending (no verificó email aún), forgot-password aún funciona — el reset también marca `email_verified_at` si no estaba. Actualmente NO lo hace. Considerar futuro.

### Reset con cuenta `suspended`

Forgot-password silencioso ignora suspended? Actualmente solo filtra `deleted`. Suspended sí recibe email. Si suspended, login bloqueará después de reset igual. OK.

### Múltiples requests forgot-password seguidos

Cada nuevo request invalida los tokens previos (`used_at = now()`). Solo el último link funciona. Esto previene atacante con email viejo si la víctima pidió uno nuevo.

## Tabla `password_resets`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID v7 PK | |
| `user_id` | FK users CASCADE | |
| `token_hash` | varchar(255) UNIQUE | SHA-256 del token plano |
| `expires_at` | timestamptz | TTL_HOURS desde creación |
| `used_at` | timestamptz NULL | NULL = aún válido |
| `ip` / `user_agent` | | de quien pidió el reset |
| `created_at` | timestamptz | |

## Tabla `password_history`

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `user_id` | FK users CASCADE |
| `password_hash` | varchar(255) Argon2id |
| `created_at` | timestamptz |

Solo se guardan las últimas N (default 5). Trim automático al insertar.

## Audit logs generados

| Acción | Cuándo |
|---|---|
| `auth.password.reset_requested` | Forgot-password con user existente |
| `auth.password.reset_completed` | Reset exitoso |
| `auth.password.changed` | Change-password exitoso |
| `auth.password.change_failed` | Current password incorrecta |

## Configuración `.env`

```
PASSWORD_HISTORY_SIZE=5
PASSWORD_RESET_TTL_HOURS=1
RATE_LIMIT_FORGOT_PER_HOUR=3
```

## Ver también

- [docs/emails/](../emails/README.md) — plantilla `reset.html`
- [docs/arquitectura/seguridad.md](../arquitectura/seguridad.md) — Argon2id params
- [docs/api/auth.md](../api/auth.md) — endpoints detallados
