# Multi-app

El SSO sirve a múltiples aplicaciones de GEMMATEX. Esta es la arquitectura para que funcione limpio.

## Concepto

Una sola **identidad de usuario** (en `users`), múltiples **aplicaciones consumidoras** (en `applications`).

```
applications              (E-commerce, Tickets, CRM, etc.)
   │
   │ application_id
   ▼
refresh_tokens            (registro de qué app emitió qué token)
   │
   │ user_id
   ▼
users  ◄──── client_profiles / admin_profiles / user_roles
```

## Tabla `applications`

Cada app que consume el SSO debe estar registrada:

| Campo | Ejemplo |
|---|---|
| `name` | `tickets-soporte` (slug interno) |
| `display_name` | `Tickets de Soporte` (UI) |
| `client_id` | `app_tickets_dev` (público, identifica la app en requests) |
| `client_secret_hash` | Hash Argon2 (solo apps tipo `service`/`mobile`/`desktop`) |
| `type` | `spa-web`, `mobile`, `desktop`, `service` |
| `audience` | `tickets` (claim `aud` del JWT) |
| `allowed_origins` | `['https://tickets.gemmatex.com']` (CORS) |
| `allowed_redirect_uris` | Para futuro OAuth flow completo |
| `is_active` | bool |

## Tipos de aplicación

| Tipo | Quién | Tiene `client_secret`? |
|---|---|---|
| **spa-web** | Frontend en navegador (React, Vue) | **No** — código JS expone |
| **mobile** | App iOS/Android | Sí |
| **desktop** | Electron, Tauri | Sí |
| **service** | Backend de otro micro | Sí |

⚠ La regla está enforced por CHECK constraint en DB:
```sql
CHECK (
  (type = 'spa-web' AND client_secret_hash IS NULL)
  OR (type IN ('mobile','desktop','service') AND client_secret_hash IS NOT NULL)
)
```

## Cómo se identifica la app

Cada request a `/api/v1/auth/register`, `/api/v1/auth/login` lleva header:

```
X-Client-Id: app_ecommerce_dev
```

El SSO:
1. Busca `applications` por `client_id`.
2. Verifica `is_active = true`.
3. Usa `audience` para emitir el claim `aud` del JWT.
4. Guarda `application_id` en `refresh_tokens`.

Si `X-Client-Id` falta o es inválido → 400.

## El claim `aud` en el JWT

```json
{
  "sub": "019e2db0-d23f...",
  "aud": "ecommerce",
  "roles": ["client"],
  "app_id": "019e2db0-d1fc..."
}
```

Otros microservicios **validan** que su nombre esté en `aud`:

```js
// En Tickets backend
jwt.verify(token, publicKey, {
  algorithms: ['RS256'],
  audience: 'tickets',  // ← rechaza si no
});
```

Aislamiento natural: un token emitido para `ecommerce` NO funciona en Tickets.

## Caso: token "compartido" entre apps

Si quieres un token válido para **e-commerce** y **tickets** (cliente accede a ambas con misma sesión), emite con array:

```json
{ "aud": ["ecommerce", "tickets"] }
```

Esto se puede hacer si las apps comparten la misma identidad de cliente. Actualmente el SSO emite con audience único; añadir multi-audience es 1 línea futura.

## Cambio de app durante una sesión

Cliente loguea en e-commerce → recibe `aud: ecommerce`. Luego entra a tickets:

**Opción A**: re-loguea en tickets (cookie session por dominio).

**Opción B (futuro)**: SSO endpoint `/api/v1/auth/exchange` que con un token válido para `ecommerce` emite uno equivalente para `tickets` (sin re-loguear, sin password). Esto es el flujo OAuth completo.

MVP usa opción A.

## Roles compartidos vs por app

`roles` es global: si un usuario tiene rol `client`, lo tiene en TODAS las apps.

¿Necesitas roles distintos por app? (ej: `staff` en Tickets, `admin` en CRM). Hay 2 caminos:

1. **Roles globales** (lo que hace el SSO ahora). `admin` aplica en todas.
2. **`application_user_roles`** (tabla M:N por app). No implementado MVP.

Para MVP, mantenemos roles globales: simple, suficiente.

## Apps estándar (convención naming)

| App | client_id dev | client_id prod | audience | type |
|---|---|---|---|---|
| account portal | `app_account_portal_dev` | `app_account_portal_prod` | `account` | `spa-web` |
| e-commerce | `app_ecommerce_dev` | `app_ecommerce_prod` | `ecommerce` | `spa-web` |
| support frontend | `app_support_dev` | `app_support_prod` | `support` | `spa-web` |
| CRM | `app_crm_dev` | `app_crm_prod` | `crm` | `spa-web` |
| Tickets backend | `app_tickets_dev` | `app_tickets_prod` | `tickets` | `service` (+ client_secret) |

## Seed (dev)

`src/db/seeders/dev/20260515000001-seed-applications.js` crea las apps dev:

```
account-portal  (spa-web)   client_id: app_account_portal_dev  aud: account
ecommerce       (spa-web)   client_id: app_ecommerce_dev       aud: ecommerce
support-portal  (spa-web)   client_id: app_support_dev         aud: support
crm             (spa-web)   client_id: app_crm_dev             aud: crm
tickets-soporte (service)   client_id: app_tickets_dev         aud: tickets  + client_secret
```

El `client_secret` de Tickets se imprime UNA VEZ en la consola al correr el seed. Guárdalo en `.env` del Tickets backend.

## Producción

En prod, el seed dev NO se corre. Las apps se crean via:

- Endpoint admin `POST /api/v1/admin/applications` (a construir en paso 3G), **o**
- SQL manual con `client_secret` hasheado a mano.

`client_secret` real debería ser:
- 32+ bytes random
- Hasheado con Argon2 antes de DB
- Mostrado UNA VEZ al crearlo, jamás recuperable

## API keys = sub-credenciales por app

`api_keys` es otra tabla. Cada app puede tener N API keys (ej una por entorno: dev, staging, prod). Ver `docs/integracion/otros-microservicios.md` y futuro paso 3F.
