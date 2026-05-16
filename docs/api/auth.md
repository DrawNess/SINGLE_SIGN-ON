# API — Auth endpoints

Base URL: `http://localhost:2106` (dev) → `https://sso.gemmatex.com` (prod).

Todos los endpoints `/auth/*` aceptan/devuelven JSON (`Content-Type: application/json`).

## Headers comunes

| Header | Cuándo | Valor |
|---|---|---|
| `Content-Type` | POST con body | `application/json` |
| `X-Client-Id` | Register, Login | Identificador de la app (ej `app_ecommerce_dev`) |
| `Authorization` | Endpoints protegidos | `Bearer <access_token>` |

---

## POST `/auth/register`

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

⚠ La respuesta **no incluye tokens**. El cliente debe llamar a `/auth/login` después.

### Errores
- `400 ValidationError` — datos inválidos (Joi)
- `400 BadRequest` — `X-Client-Id` faltante o inválido
- `409 EmailInUse` — email ya registrado
- `409 PhoneInUse` — teléfono ya registrado
- `409 DocumentInUse` — documento ya registrado
- `429 TooManyRequests` — rate limit

---

## POST `/auth/login`

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

## POST `/auth/refresh`

Rota el refresh token. El viejo queda revocado con `revoked_reason='rotation'`. Devuelve par nuevo.

⚠ Si se reusa un refresh ya rotado → **detección de robo**: revoca toda la family, responde 401.

### Body
```json
{ "refresh_token": "mbqe1DNcNKNbvhVXqTazwXwM..." }
```

### Respuesta 200
Mismo formato que `/auth/login`.

### Errores
- `400 ValidationError`
- `401 InvalidRefreshToken` — no encontrado / expirado
- `401 TokenTheftDetected` — token reusado tras rotación
- `400 BadRequest` — app inactiva

---

## POST `/auth/logout`

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

## GET `/auth/me`

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

## Próximos endpoints (no implementados aún)

| Endpoint | Paso |
|---|---|
| `POST /auth/verify-email` | 3B |
| `POST /auth/resend-verification` | 3B |
| `POST /auth/verify-phone` | 3C |
| `POST /auth/forgot-password` | 3D |
| `POST /auth/reset-password` | 3D |
| `POST /auth/change-password` | 3D |
| `POST /auth/change-email` | 3D |
| `POST /auth/2fa/setup` | 3E |
| `POST /auth/2fa/enable` | 3E |
| `POST /auth/2fa/disable` | 3E |
| `POST /auth/oauth/google` | 3H |

Ver: [Roadmap](../roadmap.md).
