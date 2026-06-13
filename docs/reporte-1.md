# Reporte 1: Integración SSO ↔ API-V6

> Última actualización: 2026-06-13
> Contexto: estado post deploy producción 2026-06-08/09 + bulk emails 2026-06-13

---

## 1. Componentes

```
┌──────────────────────┐         ┌───────────────────────┐         ┌───────────────────────┐
│  Frontend Angular    │         │  SSO GEMMATEX         │         │  API-V6 GEMMATEX      │
│  - account.com.bo    │◄───────►│  https://sso          │◄───────►│  https://gemmatex     │
│  - gemmatex.com.bo   │         │  .gemmatex.com:2106   │         │  .store:3000          │
│                      │         │                       │         │                       │
│  Cliente final       │         │  Sequelize + JWT RS256│         │  Sequelize, productos │
│  Angular 21          │         │  argon2id passwords   │         │  + orders + ACL local │
└──────────────────────┘         └───────────────────────┘         └───────────────────────┘
         │                                  │                                │
         │ login + JWT                      │ JWKS público                   │
         └──────────────────────────────────┴────────────────────────────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │  PostgreSQL 16   │
                                   │  - sso_gemmatex  │ (users, roles, tokens)
                                   │  - CATALOGO_GEMMA│ (productos, orders)
                                   └──────────────────┘
```

## 2. SSO — Responsabilidades

**Qué almacena:**

- `users` — identidad (email, password_hash argon2id, status, email_verified_at)
- `client_profiles` — datos cliente final (nombre, apellido, teléfono, dirección, CI/NIT)
- `admin_profiles` — datos admin (job_title, department)
- `roles` — client, staff, admin, super_admin
- `user_roles` — N:M users ↔ roles
- `applications` — clients OAuth (account-portal, ecommerce, api-v6)
- `api_keys` — keys server-to-server con scopes
- `refresh_tokens` — sesiones rotables con detección de robo
- `password_resets`, `email_verifications` — tokens efímeros (hash sha256)
- `audit_logs` — log inmutable de eventos sensibles

**Qué emite:**

- **Access token JWT RS256** — TTL 15 min, contiene `sub` (user uuid), `aud` (app audience), `roles`, `app_id`, `sid` (session id)
- **Refresh token** — TTL 7 días, rotable, httpOnly cookie en SPA
- **JWKS público** en `https://sso.gemmatex.com/.well-known/jwks.json` — para que CUALQUIER servicio valide JWTs sin llamar al SSO

## 3. Endpoints clave del SSO

| Endpoint | Para qué |
|----------|----------|
| `POST /api/v1/auth/register` | Crear cuenta (cliente o admin) |
| `POST /api/v1/auth/login` | Login → devuelve access + refresh |
| `POST /api/v1/auth/refresh` | Rotar tokens |
| `POST /api/v1/auth/logout` | Revocar refresh |
| `POST /api/v1/auth/forgot-password` | Genera token reset, manda email |
| `POST /api/v1/auth/reset-password` | Consume token, nueva pass |
| `POST /api/v1/auth/verify-email` | Verifica email post-registro |
| `GET /api/v1/auth/me` | User actual + profile + roles |
| `PATCH /api/v1/auth/me` | Editar profile |
| `GET /api/v1/auth/sessions` | Lista sesiones activas |
| `DELETE /api/v1/auth/sessions/:id` | Cerrar sesión específica |
| `GET /.well-known/jwks.json` | Llave pública para validar JWTs |
| `GET /api/v1/admin/users/:id` | (Admin) consultar user |
| `POST /api/v1/admin/applications/:appId/api-keys` | (Admin) crear API key |

## 4. Flujo de Login (cliente final)

```
Frontend (gemmatex.com.bo)             SSO (sso.gemmatex.com)         API-V6
       │                                       │                          │
       ├─── POST /auth/login ─────────────────►│                          │
       │   { email, password }                 │ ① Verifica argon2id      │
       │   X-Client-Id: app_ecommerce_prod     │ ② Crea sid               │
       │   Origin: gemmatex.com.bo             │ ③ Emite JWT RS256        │
       │                                       │ ④ Crea refresh token     │
       │◄── 200 OK ────────────────────────────┤                          │
       │   { access_token, user, ...}          │                          │
       │   Set-Cookie: refresh=...; HttpOnly   │                          │
       │   SameSite=None; Secure; Domain=sso   │                          │
       │                                       │                          │
       ├─── GET /api/v1/orders ─────────────────────────────────────────►│
       │   Authorization: Bearer <access>      │                         │
       │                                                                  │ ⑤ Lee JWKS del SSO (1x, cached)
       │                                                                  │ ⑥ Valida firma RS256
       │                                                                  │ ⑦ Valida `iss`, `aud`, `exp`
       │                                                                  │ ⑧ Extrae user_id del JWT.sub
       │                                                                  │ ⑨ Query DB con customer_uuid
       │◄────────────────────────────────────────────────────────────────┤
       │   200 OK { orders }                                              │
       │                                                                  │
       ├─── (15 min después: access expira) ───►                          │
       ├─── POST /auth/refresh ───────────────►│                          │
       │   Cookie: refresh=...                 │ ⑩ Rota refresh           │
       │◄── 200 nuevo access + nuevo refresh ──┤                          │
```

**Puntos clave:**

- **API-V6 NUNCA llama al SSO durante el login.** Solo lee el JWKS público una vez y valida JWTs offline. Cero latencia cross-service por request.
- **El JWT es self-contained.** Roles, user_id, app_id viajan dentro. No hace falta consultar DB del SSO en cada request.
- **El refresh cookie es del dominio del SSO** (`sso.gemmatex.com`). `SameSite=None; Secure` permite cross-site request desde frontend en otro dominio.

## 5. ¿Usa API key? ¿Cuándo?

**SÍ, pero solo para llamadas server-to-server específicas.**

API-V6 tiene 2 maneras de autenticarse contra el SSO:

| Mecanismo | Cuándo | Header |
|-----------|--------|--------|
| **JWT del cliente** | Validar request de un usuario logueado (ej. GET /orders del cliente) | `Authorization: Bearer <user_JWT>` |
| **API key del API-V6** | Llamadas internas server-to-server donde NO hay usuario (ej. lookup masivo de users por admin panel) | `Authorization: Bearer sk_live_...` |

**API key prod actual:**

- Prefix: `sk_live_5ca6a6b1`
- Scopes: `users:read`, `users:list`
- Asociada al app `app_api_v6_prod`
- Guardada en `.env` del API-V6 como `SSO_API_KEY`

**Cuándo se usa la API key (en código actual):**

Archivo `services/sso-client.service.js` del API-V6 — hace lookups de usuarios al SSO cuando algún flujo administrativo lo requiere (ej. admin panel listando clientes). NO se usa en cada GET /orders del cliente final.

```js
// Ejemplo simplificado
const ssoClient = axios.create({
  baseURL: ssoConfig.baseUrl,
  headers: { Authorization: `Bearer ${ssoConfig.apiKey}` },
});

await ssoClient.get(`/api/v1/admin/users/${uuid}`);
```

## 6. Variables de entorno API-V6 (las que metimos)

```bash
SSO_BASE_URL=https://sso.gemmatex.com
SSO_JWKS_URL=https://sso.gemmatex.com/.well-known/jwks.json
SSO_ISSUER=sso.gemmatex.com               # validar JWT.iss
SSO_AUDIENCE=account,ecommerce            # lista de aud aceptados
SSO_CLIENT_ID=app_api_v6_prod             # propio client_id
SSO_CLIENT_SECRET=<...>                   # (en uso para flujos futuros OAuth)
SSO_API_KEY=sk_live_5ca6a6b1_<...>        # server-to-server lookup
```

**Validación de JWT en cada request a API-V6:**

1. Lee `Authorization: Bearer ...`
2. Decode header → toma `kid`
3. Lee JWKS (cached) → busca llave con ese `kid`
4. Verifica firma RS256 con la llave pública
5. Valida `iss == 'sso.gemmatex.com'`
6. Valida `aud ∈ ['account', 'ecommerce']`
7. Valida `exp > now`
8. Extrae `sub` → user_id, `roles` → permisos

Si todo OK → request continúa. Sino → 401.

## 7. Schema cambios en API-V6 (post integración)

**Dropped (movido a SSO):**

- `users`, `customers`, `roles`, `user_roles`

**Nuevas columnas en `orders`:**

- `customer_uuid` (UUID, referencia al SSO) — reemplaza `customer_id INT`
- Snapshot inmutable del cliente al crear orden:
  - `customer_email`, `customer_first_name`, `customer_last_name`, `customer_phone`
  - `customer_document_type`, `customer_document_number`, `customer_razon_social`
- Snapshot dirección:
  - `delivery_departamento`, `delivery_provincia`, `delivery_ciudad`
  - `delivery_calle_avenida`, `delivery_numero`, `delivery_casa_dpto`, `delivery_link_google_maps`

**Por qué snapshot:** si user cambia su dirección/teléfono en SSO después, las órdenes históricas mantienen los datos originales (regla contable/legal).

**Nueva tabla `user_branches`** (ACL local):

- `user_id UUID`, `branch_id INT`, `role_in_branch ENUM` (seller, branch_admin, cashier, manager, viewer)
- Permite que un user del SSO tenga DISTINTO rol según la sucursal
- Solo aplica a staff, no a clientes finales

## 8. Seguridad y observabilidad

| Mecanismo | Cómo |
|-----------|------|
| Brute force protection | Rate limit 10/min por IP en `/auth/login` |
| Account lockout | Tras 10 password fallidas → 15 min bloqueo |
| Detección robo de token | Cada refresh genera ID nuevo + family_id. Si llega refresh con ID viejo → toda la familia revocada + email alerta |
| Audit log | Inmutable. Eventos: register, login, logout, password.*, profile.updated, token.theft_detected |
| Token hash | Tokens en DB se guardan como `sha256(plain)`, nunca en plain |
| Password hash | argon2id con memoryCost 64MB |
| TLS | Let's Encrypt en sso.gemmatex.com (renovación auto) |

## 9. Estado actual prod (al 2026-06-13)

| Item | Estado |
|------|--------|
| SSO live | `https://sso.gemmatex.com` ✓ |
| API-V6 integrado | `https://gemmatex.store/api/v1` ✓ |
| Users migrados | 142 desde DB vieja + fresh signups = ~165 total |
| Orders históricas | 34 con customer_uuid + snapshot ✓ |
| Frontend ecommerce | `gemmatex.com.bo` ✓ |
| Frontend account | `account.gemmatex.com.bo` ✓ |
| JWT validation E2E | ✓ verificado con login real |
| SMTP | Hostinger (limitado ~100/hora — bottleneck conocido) |
| **Migration-welcome emails enviados** | **138/142** ✓ (4 casos individuales resueltos: ver sección 12) |
| Dashboard endpoint `/admin/stats` | ✓ deployed con timezone, semi-open ranges, comparación periodo anterior, data quality |
| Índices DB para stats | ✓ migration `20260611000001-add-stats-indexes` aplicada |

## 10. Endpoints administrativos disponibles

| Endpoint | Para qué | Doc |
|----------|----------|-----|
| `GET /admin/stats` | Reporte agregado con filtros temporales | `docs/api-admin-stats.md` |
| `GET /admin/users` | Lista paginada con filtros | (referencia: admin.router.js) |
| `GET /admin/users/:id` | Detalle de un user |  |
| `PATCH /admin/users/:id` | Editar user (admin) |  |
| `DELETE /admin/users/:id` | Soft-delete user |  |
| `POST /admin/users/:id/restore` | Restaurar soft-deleted |  |
| `GET /admin/audit-logs` | Logs de eventos auditables, paginado |  |
| `POST /admin/applications` | Crear nueva app (client OAuth) |  |
| `POST /admin/applications/:appId/api-keys` | Crear API key con scopes |  |

Todos requieren auth `admin` o `super_admin`.

## 11. Pendientes y deferred

### Trabajo Frontend (pendiente del cliente Angular)

| Feature | Prioridad |
|---------|-----------|
| Dashboard admin — sección Profile Completeness con CTA campañas | Alta |
| Dashboard admin — sección Top Failure IPs / Security | Alta |
| Dashboard admin — sección Logins by Application | Media |
| Dashboard admin — sección Onboarding (p50/p90) | Media |
| Dashboard admin — corregir denominadores (% activos vs total) | Baja |
| Página `/accept-invitation?token=` | Media |
| Página `/confirm-email-change?token=` | Media |

### Trabajo Backend (pendiente)

| Feature | Esfuerzo | Estado |
|---------|----------|--------|
| Flag `imported_from` en users (excluir migración del conteo "nuevos") | 30 min | Pendiente |
| Endpoint export CSV (`/admin/users?format=csv`, `/admin/audit?format=csv`) | 2h | Pendiente |
| Migrar SMTP a Brevo (para evitar ratelimit en campañas futuras) | 30 min + Brevo signup | Decidido esperar |
| Snapshot histórico semanal (tabla `stats_snapshots` + cron) | 2h | Pendiente (alto valor para tracking campañas) |
| Heatmap por hora en `/admin/stats` | 1h | Pendiente |
| Engagement buckets (1/2-5/5+ logins por user) | 30 min | Pendiente |

### Deferred (no urgentes)

| Feature | Razón |
|---------|-------|
| Phone verification (SMS o WhatsApp) | Costo recurrente — esperar señales reales de fake signups |
| reCAPTCHA en registro | A evaluar si crecen fake signups |
| 2FA TOTP | Útil pero no crítico aún |
| OAuth Google/Facebook login | Ampliaría conversión, no urgente |
| OAuth Authorization Code Flow real (paso 3J) | JWT flow actual cubre |
| Subdominio `api.gemmatex.com.bo` | `gemmatex.store` funciona |
| Cohort retention matrix | Para >1K users |
| Funnel completo (register→verify→login→order) | Requiere JOIN cross-DB |

## 12. Casos individuales del bulk email (2026-06-13)

De los 142 usuarios migrados:

- **138 recibieron** `migration-welcome` email exitosamente
- **2 usuarios ya logueados** auto-skipped (no necesitan email):
  - `nestorcalle1012@gmail.com`
  - `thegreen1012@gmail.com`
- **1 user soft-deleted** auto-skipped:
  - `pruebitsasss@gmail.com` (status=deleted en SSO, era cuenta de prueba)
- **1 caso typo** pendiente de followup manual:
  - `ronaldhullpaortuste@gemail.com` (typo: "gemail" en lugar de "gmail")
  - Acción: WhatsApp manual al teléfono `+59171171968` para confirmar email correcto
  - Si confirma: `UPDATE users SET email='...' WHERE email='...'` + reenvío con `--only` y `--force`

## 13. Decisiones recientes

| Fecha | Decisión | Razón |
|-------|----------|-------|
| 2026-06-13 | Mantener SMTP Hostinger por ahora | Funciona para volumen actual, migrar a Brevo cuando volumen lo justifique |
| 2026-06-13 | NO implementar phone verification (SMS/WhatsApp) | Costo recurrente; controles actuales (email verify + rate limit) son suficientes |
| 2026-06-13 | NO implementar reCAPTCHA por ahora | Esperar señales reales de abuso |
| 2026-06-11 | Migración con flag `migration=initial` NO retroactiva | Aceptar conteo actual; agregar flag cuando se considere prioritario |
