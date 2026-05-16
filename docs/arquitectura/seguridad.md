# Seguridad

Resumen de las protecciones aplicadas en el SSO.

## Contraseñas

**Argon2id**, parámetros OWASP 2024:

| Parámetro | Valor |
|---|---|
| Tipo | `argon2id` |
| memoryCost | 65536 (64 MB) |
| timeCost | 3 |
| parallelism | 4 |

- Nunca en plano.
- Nunca en logs.
- Nunca en respuestas API (excluido por `User.toJSON()`).

### Política

- Mínimo 8 caracteres.
- Al menos 1 mayúscula, 1 minúscula, 1 número (Joi `auth.schemas.js`).
- No reusar las últimas 5 (tabla `password_history`) — *aplicado en reset password, próxima iteración*.

## Lockout tras intentos fallidos

- `LOGIN_MAX_ATTEMPTS=5` intentos.
- Tras 5 fallos seguidos → `locked_until = NOW() + 15 min`.
- El login mismo NO revela si la cuenta está bloqueada por estados internos para evitar enumeración. **Excepción**: una vez bloqueada, sí avisa para que el usuario sepa esperar.

## JWT con RS256

- Algoritmo: **RS256** (firma asimétrica RSA 4096 bits).
- Clave privada: solo el SSO la posee (`src/keys/private.pem`).
- Clave pública: expuesta vía `/.well-known/jwks.json`.
- **Otros micros validan localmente** sin llamar al SSO.

### Claims emitidos

```json
{
  "sub": "019e2db0-d23f-7267-...",   // user_id
  "iss": "sso.gemmatex.local",
  "aud": ["ecommerce"],
  "iat": 1747353045,
  "exp": 1747353945,
  "roles": ["client"],
  "app_id": "019e2db0-d1fc-7a36-..."
}
```

Header:
```json
{ "alg": "RS256", "typ": "JWT", "kid": "key-2026-01" }
```

`kid` permite rotación: si se publica una segunda clave, el cliente busca en JWKS por `kid` y usa la correcta.

## Refresh tokens

- 48 bytes aleatorios base64url-safe.
- Almacenados como **SHA-256 hex** en `refresh_tokens.token_hash`. Nunca en plano.
- TTL configurable (`JWT_REFRESH_TTL_DAYS`, default 7 días).
- Rotación obligatoria en cada uso (`/auth/refresh` revoca el viejo y emite uno nuevo).

### Family + detección de robo

Cada login crea un `family_id` UUID v7. Todas las rotaciones del mismo flujo comparten ese `family_id`.

Cuando se llama `/auth/refresh`:

```
si token.revoked_at IS NOT NULL  →  ALGUIEN MÁS YA LO USÓ
  - probablemente atacante robó el refresh
  - revoca TODA la family (todos los tokens del flujo, incluido el del atacante)
  - registra audit_log action='auth.token.theft_detected'
  - responde 401 TokenTheftDetected
```

Esto contiene el robo aunque el atacante ya haya rotado: queda invalidado a su vez.

## Almacenamiento de tokens en otros lados (recomendación)

| Tipo de cliente | Access token | Refresh token |
|---|---|---|
| Web (browser SPA) | memoria (variable JS) | Cookie `httpOnly`+`Secure`+`SameSite=Strict` |
| Móvil nativo | memoria | Keychain (iOS) / Keystore (Android) |
| Desktop Electron | memoria | OS Keychain via safeStorage |
| Servidor (otros micros) | N/A | Variable de entorno / Secret Manager |

⚠ **Nunca** guardar refresh en `localStorage` o `sessionStorage` en browser — vulnerable a XSS.

## CSRF

Si activas cookie httpOnly para refresh, añade protección CSRF:
- Header `X-CSRF-Token` con valor doble-submit, **o**
- `SameSite=Strict` (cubre la mayoría de casos en MVP).

*MVP usa body JSON, no cookies → CSRF no aplica todavía.*

## Rate limiting

| Endpoint | Límite |
|---|---|
| `POST /auth/login` | 5/min por IP+email |
| `POST /auth/register` | 10/hora por IP |
| `POST /auth/forgot-password` | 3/hora por email |

Configurable en `.env`:
```
RATE_LIMIT_LOGIN_PER_MIN=5
RATE_LIMIT_FORGOT_PER_HOUR=3
RATE_LIMIT_REGISTER_PER_HOUR=10
```

## HTTPS / TLS

⚠ En producción **siempre detrás de TLS** (nginx/Caddy/load balancer). El SSO no termina TLS por sí solo.

Si está detrás de proxy: `app.set('trust proxy', 1)` ya está activo en `index.js`. Esto hace que `req.ip` lea de `X-Forwarded-For` correctamente.

## Cifrado simétrico para datos sensibles en DB

`auth_providers.access_token_enc` y `refresh_token_enc` (tokens OAuth de Google/Facebook) se guardan cifrados con **AES-256-GCM**.

- Key: variable `ENCRYPTION_KEY` (32 bytes hex).
- Formato: base64( iv[12] || ciphertext || authTag[16] ).
- Helper: `src/utils/crypto.js` (`encrypt()`, `decrypt()`).

## CHECK constraints en DB

Garantizan integridad incluso ante SQL directo (no solo Sequelize):

```sql
-- phone formato Bolivia
CHECK (phone ~ '^\+591[0-9]{8}$')

-- NIT exige razon_social
CHECK (
  document_type IS NULL
  OR document_type = 'CI'
  OR (document_type = 'NIT' AND razon_social IS NOT NULL)
)

-- SPA web no tiene client_secret
CHECK (
  (type = 'spa-web' AND client_secret_hash IS NULL)
  OR (type IN ('mobile','desktop','service') AND client_secret_hash IS NOT NULL)
)
```

## Auditoría completa

Tabla `audit_logs` registra cada evento de seguridad:

| action | Cuándo |
|---|---|
| `auth.register` | Usuario nuevo creado |
| `auth.login.success` | Login OK |
| `auth.login.failed` | Login fallido (con razón) |
| `auth.logout` | Logout normal |
| `auth.token.refreshed` | Rotación normal |
| `auth.token.theft_detected` | 🚨 Posible robo |
| `auth.password.changed` | (próxima iteración) |
| `user.suspended` | (próxima iteración) |
| `role.assigned` | (próxima iteración) |

`actor_id`, `actor_type`, `ip`, `user_agent`, `metadata` (JSONB) — todo capturado.

## Helmet

`helmet()` aplicado globalmente. Cubre:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Strict-Transport-Security` (si HTTPS)
- `Content-Security-Policy` por defecto
- Más cabeceras de seguridad.

## CORS

Solo orígenes en `CORS_ORIGINS` del `.env` (coma-separados) pueden hacer requests con credentials.

## Anti-enumeración

`POST /auth/login` devuelve el **mismo error genérico** para:
- Email no existe
- Password incorrecta

Esto impide al atacante saber si un email está registrado.

`POST /auth/forgot-password` (próxima iteración) devolverá `200 OK` siempre, exista o no el email.
