# API — `/api/v1/internal/*` (service-to-service)

Endpoints consumidos por **otros backends** (Tickets, E-commerce worker, etc.), NO por usuarios humanos.

## Autenticación

**API keys** (no JWT). Header:

```
Authorization: Bearer sk_live_<prefix>_<secret>
```

JWT NO sirve aquí — el middleware exige prefijo `sk_`. Error si llega JWT user:
```
401 Unauthorized: Se esperaba una API key (prefijo sk_)
```

## Cómo obtener una API key

Admin la crea desde:

```
POST /api/v1/admin/applications/:appId/api-keys
```

Detalle: [docs/api/admin.md](./admin.md#api-keys).

## Scopes válidos

| Scope | Permite |
|---|---|
| `users:read` | `GET /internal/users/:id` |
| `users:list` | `GET /internal/users` |
| `applications:read` | (reservado, futuro) |
| `audit:write` | (reservado, futuro) |

Si la key no tiene el scope requerido → 403 InsufficientScope.

## Endpoints

---

### GET `/api/v1/internal/whoami`

Echo / debug. Sin scope específico, valida solo que la key sea válida.

#### Headers
```
Authorization: Bearer sk_live_5b5d7fe8_UbuumsZ...
```

#### Respuesta 200
```json
{
  "application": {
    "id": "019e2db0-...",
    "name": "tickets-soporte",
    "audience": "tickets"
  },
  "api_key": {
    "id": "019e45c9-...",
    "name": "tickets-backend-test",
    "prefix": "sk_live_5b5d7fe8",
    "scopes": ["users:read", "users:list"],
    "expires_at": null,
    "last_used_at": "2026-05-20T14:27:58.689Z"
  }
}
```

---

### GET `/api/v1/internal/users/:id`

Devuelve datos de un usuario para consumo s2s. Requiere scope **`users:read`**.

#### Respuesta 200
```json
{
  "user": {
    "id": "019e2db0-...",
    "email": "...",
    "status": "active",
    "email_verified_at": "...",
    "clientProfile": { "first_name": "...", "last_name": "...", "phone": "...", "..." },
    "adminProfile": null,
    "roles": ["client"]
  }
}
```

Campos sensibles (`password_hash`, `totp_secret`) excluidos automáticamente por `User.toJSON()`.

#### Errores
- `401 Unauthorized` / `InvalidApiKey` / `ApiKeyRevoked` / `ApiKeyExpired`
- `403 InsufficientScope`
- `404 NotFound`

---

### GET `/api/v1/internal/users`

Lista paginada. Requiere scope **`users:list`**.

#### Query params
| Param | Tipo | Notas |
|---|---|---|
| `page` | int ≥1 | |
| `page_size` | int 1-100 | |
| `status` | enum | filter por status |
| `email` | string | exact match |

#### Respuesta 200
```json
{
  "items": [ { /* user con profile + roles */ } ],
  "pagination": { "page": 1, "page_size": 20, "total": 5, "total_pages": 1 }
}
```

---

## Audit logs generados

| Endpoint | Action |
|---|---|
| `GET /internal/users/:id` | `internal.user.read` |
| `GET /internal/users` | `internal.users.list` |

Cada llamada queda registrada con `actor_type='api_key'`, `api_key_id`, `application_id`.

## Comportamiento del middleware `requireApiKey`

1. Extrae `Bearer` del header.
2. Verifica prefijo `sk_`. Si no → 401.
3. `sha256(plain)` → busca en `api_keys.key_hash`.
4. Valida `revoked_at IS NULL` + `expires_at` futuro o NULL.
5. Valida `application.is_active = true`.
6. Verifica scopes requeridos están en `api_keys.scopes`.
7. Side effect: actualiza `last_used_at` + `last_used_ip` (best effort).
8. Setea `req.apiKey` + `req.application` para uso del controller.

## Ejemplo cliente (Tickets backend Node.js)

```js
const SSO_URL = process.env.SSO_URL;          // https://sso.gemmatex.com.bo
const SSO_API_KEY = process.env.SSO_API_KEY;  // sk_live_xxx_yyy

async function fetchUser(userId) {
  const res = await fetch(`${SSO_URL}/api/v1/internal/users/${userId}`, {
    headers: { 'Authorization': `Bearer ${SSO_API_KEY}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SSO error ${res.status}: ${body}`);
  }
  const { user } = await res.json();
  return user;
}
```

## Recomendaciones operacionales

- **Una key por entorno** (dev/staging/prod). Naming sugerido: `tickets-backend-prod`, `tickets-backend-dev`.
- **Una key por servicio**. Si Tickets y E-commerce comparten misma key → comprometer una compromete ambos. Separar.
- **Rotar regularmente** o tras sospecha de compromiso. Crea nueva key, despliega a consumidor, revoca la vieja tras propagación.
- **`expires_at` opcional**. Considera setear 90 días para forzar rotación automática.
- **Guarda la key en gestor de secretos** (Vault, AWS Secrets Manager, Doppler). NUNCA en repo.
- **Monitorea `last_used_at`**. Si una key prod no se usa en 7 días → quizás está deshabilitada o el servicio cayó.

## Producción

- HTTPS obligatorio (TLS termina antes del SSO).
- Rate limit recomendado por API key (no implementado todavía, futuro).
- Considera firma de payload con HMAC adicional si la red entre micros NO es confiable.
