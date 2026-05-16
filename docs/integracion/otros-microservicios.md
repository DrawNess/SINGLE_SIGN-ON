# Integración con otros microservicios

Cómo Tickets, E-commerce, CRM consumen el SSO.

## 1. Registrarse en el SSO (una vez por app)

Cada app debe estar en la tabla `applications`. En dev se crean via seed. En prod, super_admin las crea via endpoint admin (paso 3G).

Resultado: cada app recibe:
- `client_id` (público, ej `app_tickets_prod`)
- `client_secret` (privado, solo apps `service`/`mobile`/`desktop`)
- `audience` (claim `aud` que el SSO emitirá en JWT para esa app)

## 2. Validar JWT del usuario (en cada request a tu micro)

Cuando un cliente llega a Tickets con un JWT en el header `Authorization`, Tickets valida:

```js
// Tickets backend (Node.js)
const { createRemoteJWKSet, jwtVerify } = require('jose');

const JWKS = createRemoteJWKSet(
  new URL(process.env.SSO_JWKS_URL),       // https://sso.gemmatex.com/.well-known/jwks.json
  { cacheMaxAge: 60 * 60 * 1000 }          // 1 hora
);

async function verify(token) {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.SSO_ISSUER,        // sso.gemmatex.com
      audience: process.env.SSO_AUDIENCE,    // tickets
    });
    return payload;
    // payload = { sub, roles, app_id, iat, exp, iss, aud }
  } catch (err) {
    throw new UnauthorizedError(err.message);
  }
}
```

Middleware Express:

```js
async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'NoToken' });

  try {
    const payload = await verify(token);
    req.user = {
      id: payload.sub,
      roles: payload.roles,
    };
    next();
  } catch {
    res.status(401).json({ error: 'InvalidToken' });
  }
}
```

### `.env` del micro consumidor

```
SSO_JWKS_URL=http://localhost:2106/.well-known/jwks.json
SSO_ISSUER=sso.gemmatex.local
SSO_AUDIENCE=tickets
```

## 3. Consultar datos del cliente al SSO (service-to-service)

A veces Tickets necesita datos del cliente: nombre, teléfono, dirección. No están en el JWT (solo van: user_id, roles, audience).

Tickets pregunta al SSO. Pero no como usuario → como servicio. Usa **API key**.

### Flujo

```
Tickets backend                                      SSO
     │                                                 │
     │  GET /api/v1/internal/users/<id>                │
     │  Authorization: Bearer sk_live_...              │
     │ ──────────────────────────────────────────►    │
     │                                     │
     │                              detect prefix sk_
     │                              sha256(key) lookup
     │                              check revoked_at / expires_at
     │                              check scopes contains 'users:read'
     │                                     │
     │  200 user data                      │
     │ ◄────────────────────────────────  │
```

**Endpoint `/api/v1/internal/users/:id` no está implementado todavía** (paso 3F). Pero el schema y middleware estarán listos.

### API key obtenida

Super_admin crea una API key:
```bash
POST /api/v1/admin/applications/<tickets_app_id>/api-keys
{
  "name": "tickets-backend-prod",
  "scopes": ["users:read", "users:list"]
}
```

Respuesta UNA VEZ (no se muestra después):
```json
{
  "id": "...",
  "key": "sk_live_a1b2c3d4_xxxxxxxxxxxxxxxx...",
  "prefix": "sk_live_a1b2c3d4",
  "scopes": ["users:read", "users:list"]
}
```

Tickets guarda `key` en su `.env`:
```
SSO_API_KEY=sk_live_a1b2c3d4_xxxxxxxxxxxxxxxx...
```

### Usar la key

```js
// Tickets backend
const SSO_API_KEY = process.env.SSO_API_KEY;

async function fetchUser(userId) {
  const res = await fetch(`${SSO_URL}/api/v1/internal/users/${userId}`, {
    headers: {
      'Authorization': `Bearer ${SSO_API_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`SSO error: ${res.status}`);
  return res.json();
}
```

## 4. Errores comunes

### `401 Unauthorized` con JWT válido

- Verifica que `aud` del JWT coincida con `SSO_AUDIENCE` del micro.
- Verifica que `iss` coincida con `SSO_ISSUER`.
- Verifica que el reloj del servidor no esté desfasado (>5min de skew rompe JWT).

### JWKS no descarga

- Verifica que `SSO_JWKS_URL` sea accesible desde el micro (firewall, DNS).
- En desarrollo: confirma `http://localhost:2106/.well-known/jwks.json` responde con `curl`.

### API key falla con 401

- Verifica el prefijo es exacto (`sk_live_`).
- Verifica que la key no esté revocada (`revoked_at` en DB).
- Verifica que tenga el scope necesario para el endpoint.

## 5. Recomendaciones

### En cliente frontend (E-commerce SPA)

- Guardar `access_token` solo en memoria (variable JS).
- Guardar `refresh_token` en **cookie httpOnly** (cuando se implemente — paso futuro).
- Renovar access ~10-12 min (antes de los 15 min de expiración).
- Si refresh falla → redirigir a login.

### En cliente móvil

- `access_token` en memoria.
- `refresh_token` en almacenamiento seguro del OS:
  - iOS: Keychain (`react-native-keychain`)
  - Android: Keystore (`react-native-encrypted-storage`)

### En backend (servicios)

- `SSO_API_KEY` en variables de entorno (gestor de secretos en prod).
- NO hacer log de la API key.
- Reportar errores de auth al sistema de monitoreo.

## 6. Estructura de un JWT real

Decodifica un JWT en https://jwt.io o con:
```bash
echo "<token>" | cut -d. -f2 | base64 -d | jq
```

Ejemplo:
```json
{
  "roles": ["client"],
  "app_id": "019e2db0-d1fc-7a36-af08-c3678683d7dc",
  "iat": 1747353045,
  "exp": 1747353945,
  "aud": "ecommerce",
  "iss": "sso.gemmatex.local",
  "sub": "019e2dc3-5fe9-7ce3-a562-839d0b174ca8"
}
```

| Claim | Significado |
|---|---|
| `sub` | user_id (UUID v7) |
| `aud` | audience — debe coincidir con tu app |
| `iss` | issuer — debe coincidir con tu config |
| `roles` | array de roles |
| `app_id` | id de la application emisora |
| `iat` | issued at (timestamp UNIX) |
| `exp` | expires at |

## 7. Ejemplo completo de integración (Tickets)

```js
// tickets-backend/src/middleware/auth.js
const { createRemoteJWKSet, jwtVerify } = require('jose');

const JWKS = createRemoteJWKSet(
  new URL(process.env.SSO_JWKS_URL),
  { cacheMaxAge: 3600 * 1000 }
);

async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Bearer token requerido' });
  }
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.SSO_ISSUER,
      audience: process.env.SSO_AUDIENCE,
    });
    req.user = { id: payload.sub, roles: payload.roles };
    next();
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
}

// uso
router.get('/tickets', requireAuth, async (req, res) => {
  const tickets = await Ticket.findAll({ where: { user_id: req.user.id } });
  res.json({ tickets });
});
```
