# Overview — SSO GEMMATEX

## Qué es

Microservicio independiente que **centraliza la autenticación** para todas las aplicaciones de GEMMATEX. Una cuenta de usuario sirve para acceder a múltiples apps con un solo login (Single Sign-On).

## Por qué centralizar

| Antes (sin SSO) | Después (con SSO) |
|---|---|
| Cada app tiene su login | Una sola autoridad |
| Cliente registra N veces | Cliente registra una vez |
| N tablas de usuarios distintas | Una tabla `users` |
| Inconsistencias datos | Single source of truth |
| Cambiar password en N apps | Cambiar password una vez |

## Aplicaciones consumidoras

```
         ┌──────────────────────────┐
         │   SSO GEMMATEX (este)    │
         │                          │
         │ - users / roles          │
         │ - tokens (JWT + refresh) │
         │ - JWKS público           │
         └────────────┬─────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
   ┌────────┐   ┌────────┐    ┌────────┐
   │E-comm. │   │Tickets │    │  CRM   │
   │(client)│   │(client)│    │(admin) │
   └────────┘   └────────┘    └────────┘
```

- **E-commerce** y **Tickets de Soporte** → atienden **clientes** (rol `client`).
- **CRM** → atiende **staff/admin** (roles `staff`, `admin`, `super_admin`).
- Todas comparten la misma identidad: si Juan ya tiene cuenta para E-commerce, automáticamente puede usar Tickets sin re-registrarse.

## Tres tipos de auth

| Tipo | Quién | Cómo |
|---|---|---|
| **Login con email + password** | Personas (cliente, admin, staff) | `POST /api/v1/auth/login` → JWT |
| **OAuth (futuro)** | Personas, vía Google/Facebook | `POST /api/v1/auth/oauth/google` |
| **API key** | Servicios (Tickets-backend, etc.) | Header `Authorization: Bearer sk_live_...` |

## Distribución de identidad

El SSO emite **JWT firmados con RS256**. La clave **privada** firma; queda en este servicio. La clave **pública** se expone vía:

```
GET /.well-known/jwks.json
```

Otros microservicios descargan la pública una vez, la cachean, y **validan JWT localmente sin llamar al SSO** en cada request. Eficiente y resistente a caídas.

## Identificación de la app que origina la auth

Cada request a `/api/v1/auth/register` o `/api/v1/auth/login` debe llevar el header:

```
X-Client-Id: app_ecommerce_dev
```

Esto:
- Permite al SSO saber **qué app** está originando el flujo
- Inserta `application_id` en `refresh_tokens` (rastreabilidad)
- Establece el claim `aud` del JWT (qué app puede consumirlo)
- Permite políticas distintas (ej. CRM exige 2FA)

## Cliente vs Cliente OAuth

⚠ Cuidado con la terminología:

- **Cliente persona** = usuario humano con rol `client` (alguien que compra en e-commerce)
- **OAuth client** = aplicación consumidora (e-commerce, tickets, crm)

Para distinguir, en este proyecto:
- "cliente" sin más → persona
- "application" o "OAuth client" → app consumidora

## Diferencias con OAuth 2.0 puro

El SSO sigue principios OAuth 2.0 / OIDC pero **no implementa el flujo completo `authorization_code`** en MVP.

| OAuth 2.0 estándar | SSO GEMMATEX MVP |
|---|---|
| `/authorize` + `/token` | `/api/v1/auth/login` directo |
| `code → token` exchange | Login devuelve tokens directo |
| Redirect URIs | Reservado en schema, no usado aún |
| Discovery endpoint | Solo JWKS |

Esto se puede ampliar a OAuth completo en el futuro sin romper el schema (campos `allowed_redirect_uris`, `client_id`, `client_secret_hash` ya existen).

## Aislamiento por audiencia (audience)

Un JWT emitido para `aud: ecommerce` **no debe** ser válido en CRM. Cada microservicio valida que su nombre esté en `aud`:

```js
// En Tickets backend
const decoded = jwt.verify(token, publicKey, {
  algorithms: ['RS256'],
  audience: 'tickets',  // ← rechaza si aud no incluye 'tickets'
  issuer: 'sso.gemmatex.local'
});
```

Si CRM emite tokens con `aud: crm`, el e-commerce no los acepta. Aislamiento natural por audience.
