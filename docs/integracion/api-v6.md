# Integración SSO ↔ API-V6 Ecommerce

Microservicio API-V6 (catálogo + órdenes) delega identidad al SSO GEMMATEX.

## Aplicación registrada

| Campo | Valor |
|---|---|
| `name` | `api-v6-dev` |
| `client_id` | `app_api_v6_dev` |
| `display_name` | `API V6 Ecommerce Dev` |
| `type` | `service` |
| `audience` | `api-v6` |
| `allowed_origins` | `http://localhost:1115` |

Application creada por el seeder dev `20260515000001-seed-applications.js` (junto con `tickets-soporte`, `facturacion-backend`, etc.). En prod, super_admin la crea vía `POST /api/v1/admin/applications`.

El seeder imprime el `client_secret` UNA VEZ en consola. El `api_key` se crea aparte vía `POST /api/v1/admin/applications/<id>/api-keys` con scopes `users:read`, `users:list`.

## API key

Scopes mínimos requeridos:

- `users:read` — leer perfil de un usuario por UUID al crear orden (snapshot)
- `users:list` — autocompletar dropdown al asignar staff a sucursal

> `audit:write` existe como scope reservado en `apiKey.service.js` y `admin.schemas.js`, pero ningún endpoint lo consume todavía. No incluirlo hasta que haya endpoint `POST /api/v1/internal/audit-logs` que lo requiera.

Auth en API-V6 → SSO: header `Authorization: Bearer sk_live_<rest>` contra `/api/v1/internal/*`.

## Endpoints SSO usados por API-V6

| Endpoint | Scope | Cuándo |
|---|---|---|
| `GET /api/v1/internal/whoami` | — | health check |
| `GET /api/v1/internal/users/:id` | `users:read` | al crear orden (snapshot cliente) |
| `GET /api/v1/internal/users` | `users:list` | autocompletar UI admin |

## Flujo cliente típico

```
1. Cliente loguea en SSO (X-Client-Id: app_ecommerce_dev) → JWT aud=ecommerce
2. Cliente POST /api/v1/orders en API-V6 con JWT
3. API-V6 ssoAuth valida JWT vía JWKS (issuer + aud)
4. API-V6 llama SSO /internal/users/<sub> con API key
5. API-V6 snapshot cliente + dirección en orders (inmutable)
6. API-V6 INSERT orden con customer_uuid + 14 columnas snapshot
```

## Audience múltiple

API-V6 acepta JWTs emitidos para varias apps porque distintos perfiles entran por distintos frontends:

- `ecommerce` — cliente final compra
- `account` — admin gestiona desde portal
- `crm` — staff comercial (futuro)
- `support` — atención al cliente (futuro)
- `api-v6` — self-issued para herramientas internas

Config `SSO_AUDIENCE` en API-V6 acepta lista coma-separada.

## Lo que SSO NO maneja

Las siguientes responsabilidades viven en API-V6, no en SSO:

- Catálogo (productos, variants, colors, categories)
- Sucursales (`branches` físicas — 5 sucursales BO)
- Asignación de staff a sucursal (`user_branches`)
- Órdenes + estado + items
- Roles fine-grained dentro de sucursal (`seller`, `branch_admin`, `cashier`, `manager`, `viewer`)

API-V6 mantiene tabla `user_branches` como ACL local: `user_uuid + branch_id + role_in_branch`. Cliente final = 0 filas. Admin global = 0 filas (bypass). Solo staff necesita filas.

## Mapeo branch → departamentos (vive en código API-V6)

```
1 La Paz Casa Matriz   → La Paz (excl El Alto), Potosí, Beni
2 Cochabamba           → Cochabamba, Chuquisaca
3 El Alto Ceibo        → La Paz/El Alto, Oruro
4 El Alto Satélite     → La Paz/El Alto, Oruro
5 Santa Cruz           → Santa Cruz, Tarija, Pando
```

Archivo en API-V6: `utils/branch-areas.constants.js`.

## Seguridad

- JWT RS256 con verificación JWKS (clave pública del SSO)
- Audience-isolation (token de otra app con `aud` distinto = rechazado)
- API key tiene scopes mínimos
- API key rotable sin tocar JWT signing key
- Sequelize parametriza queries (anti-SQLi)
- Joi valida UUID en cada body con `user_id`

## Roadmap

- [ ] paso 3J: OAuth Authorization Code Flow + sso_session cookie → SSO real
- [ ] Webhook SSO→API-V6 al suspender usuario (invalida user_branches local)
- [ ] mTLS para `/internal/*`
- [ ] IP allowlist para API keys productivas
