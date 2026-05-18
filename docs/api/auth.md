# API — Auth endpoints

Base URL: `http://localhost:2106` (dev) → `https://sso.gemmatex.com` (prod).

Versionado bajo `/api/v1/`. Todos los endpoints aceptan/devuelven JSON (`Content-Type: application/json`).

> ⚠ Los endpoints `/.well-known/jwks.json` y `/health` NO están versionados — viven en la raíz (ver [well-known](./well-known.md)).

## Headers comunes

| Header | Cuándo | Valor |
|---|---|---|
| `Content-Type` | POST con body | `application/json` |
| `X-Client-Id` | Register, Login | Identificador de la app (ej `app_ecommerce_dev`) |
| `Authorization` | Endpoints protegidos | `Bearer <access_token>` |

---

## POST `/api/v1/auth/register`

Crea un nuevo cliente (rol `client`).

**Rate limit**: 10/hora por IP.

### Headers
```
Content-Type: application/json
X-Client-Id: app_ecommerce_dev
```

### Body
```json
{
  "email": "juan.perez@test.bo",
  "password": "TestPass123",
  "first_name": "Juan",
  "last_name": "Perez",
  "phone": "+59171234567",
  "document_type": "CI",
  "document_number": "1234567",
  "departamento": "La Paz",
  "provincia": "Murillo",
  "ciudad": "La Paz",
  "calle_avenida": "Av. 16 de Julio",
  "numero": "1234",
  "casa_dpto": "Dpto 4A",
  "link_google_maps": "https://maps.google.com/?q=..."
}
```

#### Campos
| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `email` | email | ✓ | único, lowercased |
| `password` | string | ✓ | min 8, 1 mayús + 1 minús + 1 número |
| `first_name`, `last_name` | string | ✓ | 2-100 chars |
| `phone` | string | ✓ | formato `+591########` |
| `document_type` | `CI`/`NIT` | ✗ | si se da, también `document_number` |
| `document_number` | string | depende | obligatorio si hay `document_type` |
| `razon_social` | string | depende | obligatorio si `document_type='NIT'` |
| `birth_date` | ISO date | ✗ | en el pasado |
| `departamento` | enum | ✓ | 9 deptos Bolivia |
| `provincia`, `ciudad`, `calle_avenida`, `numero` | string | ✓ | |
| `casa_dpto`, `link_google_maps` | string | ✗ | opcional |

### Respuesta 201
```json
{
  "message": "Cuenta creada",
  "user": {
    "id": "019e2dc3-...",
    "email": "juan.perez@test.bo",
    "status": "active",
    "email_verified_at": null,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

⚠ La respuesta **no incluye tokens**. El cliente debe llamar a `/api/v1/auth/login` después.

### Errores
- `400 ValidationError` — datos inválidos (Joi)
- `400 BadRequest` — `X-Client-Id` faltante o inválido
- `409 EmailInUse` — email ya registrado
- `409 PhoneInUse` — teléfono ya registrado
- `409 DocumentInUse` — documento ya registrado
- `429 TooManyRequests` — rate limit

---

## POST `/api/v1/auth/login`

Autentica con email + password. Devuelve par access + refresh.

**Rate limit**: 5/min por IP+email.

### Headers
```
Content-Type: application/json
X-Client-Id: app_ecommerce_dev
```

### Body
```json
{
  "email": "juan.perez@test.bo",
  "password": "TestPass123"
}
```

### Respuesta 200
```json
{
  "user": {
    "id": "019e2dc3-...",
    "email": "juan.perez@test.bo",
    "status": "active",
    "roles": ["client"],
    "last_login_at": "...",
    ...
  },
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "mbqe1DNcNKNbvhVXqTazwXwM...",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token_expires_at": "2026-05-22T22:30:00.000Z"
}
```

| Campo | Notas |
|---|---|
| `access_token` | JWT RS256, TTL `JWT_ACCESS_TTL` (default 15min) |
| `refresh_token` | 48 bytes base64url, TTL `JWT_REFRESH_TTL_DAYS` (default 7d) |
| `expires_in` | Segundos hasta que expira el access |
| `token_type` | Siempre `Bearer` |

### Errores
- `400 ValidationError` — datos inválidos
- `400 BadRequest` — `X-Client-Id` faltante
- `401 InvalidCredentials` — email o password incorrectos (genérico)
- `403 AccountSuspended` — cuenta suspendida
- `403 AccountPending` — cuenta sin verificar (futuro)
- `423 AccountLocked` — bloqueada tras N intentos fallidos
- `429 TooManyRequests` — rate limit

---

## POST `/api/v1/auth/refresh`

Rota el refresh token. El viejo queda revocado con `revoked_reason='rotation'`. Devuelve par nuevo.

⚠ Si se reusa un refresh ya rotado → **detección de robo**: revoca toda la family, responde 401.

### Body
```json
{ "refresh_token": "mbqe1DNcNKNbvhVXqTazwXwM..." }
```

### Respuesta 200
Mismo formato que `/api/v1/auth/login`.

### Errores
- `400 ValidationError`
- `401 InvalidRefreshToken` — no encontrado / expirado
- `401 TokenTheftDetected` — token reusado tras rotación
- `400 BadRequest` — app inactiva

---

## POST `/api/v1/auth/logout`

Revoca el refresh token. Requiere `Authorization` con access token válido.

### Headers
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Body
```json
{
  "refresh_token": "...",
  "all_devices": false
}
```

| Campo | Notas |
|---|---|
| `refresh_token` | Opcional. Si presente, revoca solo ese. |
| `all_devices` | Opcional. Si `true`, revoca **todos** los refresh del usuario. |

### Respuesta 204
Sin body.

### Errores
- `401 Unauthorized` — sin/inválido access token

---

## GET `/api/v1/auth/me`

Devuelve datos del usuario autenticado.

### Headers
```
Authorization: Bearer <access_token>
```

### Respuesta 200
```json
{
  "user": {
    "id": "019e2dc3-...",
    "email": "juan.perez@test.bo",
    "status": "active",
    "roles": ["client"],
    "clientProfile": {
      "user_id": "019e2dc3-...",
      "first_name": "Juan",
      "last_name": "Perez",
      "phone": "+59171234567",
      "departamento": "La Paz",
      ...
    },
    "adminProfile": null
  }
}
```

### Errores
- `401 Unauthorized`
- `404 NotFound` — usuario eliminado tras emitir token

---

---

## POST `/api/v1/auth/verify-email` · GET `/api/v1/auth/verify-email`

Consume el token enviado por email para activar la cuenta (registro) o cambiar el email (mode `email_change`).

Soporta **GET con query string** (click directo en el link del correo) y **POST con body JSON** (para SPA que extrae el token del query).

### GET — link directo
```
GET /api/v1/auth/verify-email?token=W0VK8B-mKwRZucTxayqDj2HGnVQfZ4_5-...
```

### POST — desde frontend
```json
{ "token": "W0VK8B-mKwRZucTxayqDj2HGnVQfZ4_5-..." }
```

### Respuesta 200
```json
{
  "message": "Email verificado. Tu cuenta está activa.",
  "mode": "registration"
}
```

| Campo | Valor |
|---|---|
| `mode` | `registration` (primera vez) o `email_change` (cambio de email) |

Tras `mode='email_change'`, el SSO revoca **todos los refresh tokens** del usuario por seguridad — debe re-loguear con el nuevo email.

### Errores
- `400 InvalidToken` — token no encontrado
- `400 TokenAlreadyUsed` — token ya usado
- `400 TokenExpired` — token expirado (TTL `EMAIL_VERIFY_TTL_HOURS`, default 24h)
- `409 EmailInUse` — solo en `email_change`: el nuevo email se tomó entre el request y la confirmación

---

## GET `/api/v1/auth/confirm-email-change`

Alias semántico de `GET /api/v1/auth/verify-email` para el flujo de cambio de email. Mismo comportamiento.

```
GET /api/v1/auth/confirm-email-change?token=...
```

---

## POST `/api/v1/auth/resend-verification`

Reenvía el email de verificación a un correo pendiente. Anti-enumeración: siempre responde 200, exista o no el email.

### Body
```json
{ "email": "maria.lopez@test.bo" }
```

### Respuesta 200
```json
{
  "message": "Si el correo está registrado y pendiente de verificación, recibirás un nuevo email."
}
```

Tokens anteriores activos para ese user quedan invalidados (marcados con `used_at`).

---

## POST `/api/v1/auth/change-email`

Inicia el cambio de email. Requiere autenticación + password actual. Envía email a la NUEVA dirección.

### Headers
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Body
```json
{
  "new_email": "maria.nueva@test.bo",
  "current_password": "Segura123"
}
```

### Respuesta 200
```json
{
  "message": "Te enviamos un correo a la nueva dirección. Confirma para completar el cambio."
}
```

El cambio NO toma efecto hasta que el user confirme via `/confirm-email-change` con el token del email.

### Errores
- `400 BadRequest` — `new_email` igual al actual
- `401 Unauthorized` — sin/inválido access token
- `401 InvalidPassword` — password actual incorrecta
- `409 EmailInUse` — nuevo email ya registrado por otro

---

## POST `/api/v1/auth/forgot-password`

Inicia el flujo de recuperación de contraseña. Envía email con link al frontend (`account.gemmatex.com.bo/reset-password?token=...`).

**Rate limit**: 3/hora por email.

### Body
```json
{ "email": "juan.perez@test.bo" }
```

### Respuesta 200 (siempre, anti-enumeración)
```json
{
  "message": "Si el correo está registrado, recibirás un email para restablecer tu contraseña."
}
```

⚠ Responde 200 incluso si el email no existe. Esto previene enumeración de cuentas.

### Errores
- `400 ValidationError`
- `429 TooManyRequests`

---

## POST `/api/v1/auth/reset-password`

Consume el token del email y establece nueva contraseña.

### Body
```json
{
  "token": "wT1UUCYez-qpovfbkFXS4ljJE7yAd80Kqz4AcssQB5M",
  "new_password": "NuevaSegura123"
}
```

### Respuesta 200
```json
{
  "message": "Contraseña actualizada. Inicia sesión con tus nuevas credenciales."
}
```

Tras éxito:
- Hash nuevo guardado con Argon2id.
- Hash viejo movido a `password_history`.
- **Todos** los refresh tokens revocados con `revoked_reason='password_changed'`.
- Token consumido (no reusable).
- audit `auth.password.reset_completed`.

### Errores
- `400 InvalidToken` — token no existe
- `400 TokenAlreadyUsed`
- `400 TokenExpired` — TTL `PASSWORD_RESET_TTL_HOURS` (default 1h)
- `400 PasswordReused` — coincide con la actual o últimas N (default 5)
- `400 ValidationError` — password no cumple política (min 8, mayús+minús+num)

---

## POST `/api/v1/auth/change-password`

Cambio de password por usuario autenticado (conoce la actual).

### Headers
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Body
```json
{
  "current_password": "Segura123",
  "new_password": "NuevaSegura456"
}
```

### Respuesta 200
```json
{
  "message": "Contraseña cambiada. Inicia sesión nuevamente en todos tus dispositivos."
}
```

Mismos efectos que reset-password: revoca refresh tokens, guarda history, audit.

### Errores
- `401 Unauthorized`
- `401 InvalidPassword` — current_password incorrecta
- `400 SamePassword` — nueva igual a actual
- `400 PasswordReused` — en history
- `400 ValidationError`

---

## Próximos endpoints (no implementados aún)

| Endpoint | Paso |
|---|---|
| ~~`POST /api/v1/auth/verify-phone`~~ | ~~3C~~ — Cancelado (Bolivia, SMS providers limitados) |
| `POST /api/v1/auth/forgot-password` | 3D |
| `POST /api/v1/auth/reset-password` | 3D |
| `POST /api/v1/auth/change-password` | 3D |
| `POST /api/v1/auth/2fa/setup` | 3E |
| `POST /api/v1/auth/2fa/enable` | 3E |
| `POST /api/v1/auth/2fa/disable` | 3E |
| `POST /api/v1/auth/oauth/google` | 3H |

Ver: [Roadmap](../roadmap.md).
