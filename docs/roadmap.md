# Roadmap

Funcionalidad pendiente, ordenada por prioridad.

## Estado actual ✅

- ✅ Schema DB completo (15 tablas)
- ✅ Modelos Sequelize + asociaciones
- ✅ Seeders (roles + apps + super_admin dev)
- ✅ Auth core: register, login, refresh, logout, /me
- ✅ JWT RS256 + JWKS público
- ✅ Refresh token rotation + family + theft detection
- ✅ Argon2id passwords
- ✅ Lockout tras intentos fallidos
- ✅ Audit logs
- ✅ Validación Joi
- ✅ Rate limit (login, register, forgot)
- ✅ Multi-app via `X-Client-Id`
- ✅ Helmet + CORS
- ✅ Soft delete users/applications
- ✅ Trigger automático `updated_at`
- ✅ **Verificación de email + cambio de email** (paso 3B)
- ✅ Status `pending` → `active` tras verify
- ✅ Anti-enumeración en resend
- ✅ Plantillas HTML email modulares (archivos `.html` separados)
- ✅ Hot reload de plantillas en dev
- ✅ Brand config via `.env` (logo, color, location)
- ✅ Dev log fallback sin SMTP
- ✅ **Forgot / reset / change password** (paso 3D)
- ✅ Anti-reuso con `password_history` (últimas 5 + actual)
- ✅ Revoca todos los refresh tokens al cambiar password
- ✅ Trim history automático
- ✅ Plantillas premium alineadas (verify, change, reset)

## Próximos pasos

### Paso 3B — Verificación de email ✅ COMPLETADO

- [x] Service `email.service.js` (nodemailer + plantillas)
- [x] Endpoint `GET/POST /api/v1/auth/verify-email` con token del email
- [x] Endpoint `POST /api/v1/auth/resend-verification`
- [x] Endpoint `POST /api/v1/auth/change-email` (autenticado)
- [x] Endpoint `GET /api/v1/auth/confirm-email-change`
- [x] Cambiar register a `status='pending'`
- [x] Bloquear login si email no verificado
- [x] Plantilla HTML del email (verificación + cambio)
- [x] Dev log fallback de emails

### Paso 3C — Verificación SMS ❌ CANCELADO

Decidido omitir: Bolivia tiene cobertura limitada de providers SMS (Twilio caro, Entel/Tigo sin integración directa). `phone_verified_at` queda siempre NULL. La columna `phone` sigue NOT NULL en `client_profiles` para órdenes/delivery, pero sin verificación.

Tabla `phone_verifications` queda creada por si se reactiva futuro.

### Paso 3D — Password management ✅ COMPLETADO

- [x] Endpoint `POST /api/v1/auth/forgot-password` (envía email con link)
- [x] Endpoint `POST /api/v1/auth/reset-password` (consume token)
- [x] Endpoint `POST /api/v1/auth/change-password` (autenticado)
- [x] Aplicar `password_history` check (no reusar últimas 5)
- [x] Revocar todos refresh tokens al cambiar password
- [x] Trim automático de history
- [x] Anti-enumeración en forgot-password
- [x] Rate limit forgot (3/hora/email)
- [x] Email de notificación tras cambio password (`sendPasswordChangedEmail` con IP + user-agent + timestamp, best-effort tras commit)

### Paso 3E — 2FA TOTP ⏸ DIFERIDO

Decisión: implementar más adelante. Tabla `users.totp_secret` y `totp_enabled` ya existen en schema. Pendiente lógica + endpoints:

- [ ] Endpoint `POST /api/v1/auth/2fa/setup` → genera secret + QR code
- [ ] Endpoint `POST /api/v1/auth/2fa/enable` → confirma con código TOTP
- [ ] Endpoint `POST /api/v1/auth/2fa/disable` → requiere password
- [ ] Endpoint `POST /api/v1/auth/2fa/verify` durante login si `totp_enabled=true`
- [ ] Backup codes (códigos de un solo uso)
- [ ] Cifrar `totp_secret` en DB (AES-256-GCM)

### Paso 3F — API keys (service-to-service) ✅ COMPLETADO

- [x] Middleware `apiKey.js` que detecta prefijo `sk_` en Authorization
- [x] Endpoint `POST /api/v1/admin/applications/:appId/api-keys` (crear)
- [x] Endpoint `GET /api/v1/admin/applications/:appId/api-keys` (listar)
- [x] Endpoint `DELETE /api/v1/admin/api-keys/:id` (revocar)
- [x] Endpoint `GET /api/v1/internal/whoami` (echo/debug)
- [x] Endpoint `GET /api/v1/internal/users/:id` (scope `users:read`)
- [x] Endpoint `GET /api/v1/internal/users` (scope `users:list`)
- [x] Sistema de scopes: `users:read`, `users:list`, `applications:read`, `audit:write`
- [x] Audit s2s: `internal.user.read`, `internal.users.list`, `admin.api_key.created/revoked`
- [x] Touch `last_used_at` automático
- [x] Validación de application activa

### Paso 3G — Endpoints Admin ✅ PARCIAL

Implementado:
- [x] `GET /api/v1/admin/users` (lista paginada, filtros status/role/q)
- [x] `GET /api/v1/admin/users/:id` (detalle con profile + roles)
- [x] `PATCH /api/v1/admin/users/:id` (status, roles, con auto-restricciones)
- [x] `DELETE /api/v1/admin/users/:id` (soft delete + revoke tokens)
- [x] `POST /api/v1/admin/users/:id/restore`
- [x] `GET /api/v1/admin/audit-logs` (lista paginada con filtros)
- [x] `GET /api/v1/admin/stats` (dashboard counts)
- [x] Util pagination reusable
- [x] Permisos diferenciados admin vs super_admin (roles elevados)

### Paso 3G.2 — Admin extra ✅ COMPLETADO

Applications:
- [x] `POST /api/v1/admin/applications` (crea app + genera client_secret si tipo != spa-web)
- [x] `GET /api/v1/admin/applications` (paginado, filtros)
- [x] `GET /api/v1/admin/applications/:id`
- [x] `PATCH /api/v1/admin/applications/:id`
- [x] `DELETE /api/v1/admin/applications/:id` (soft delete)
- [x] `POST /api/v1/admin/applications/:id/rotate-secret`

Invitations:
- [x] `POST /api/v1/admin/invitations` (envía email branded)
- [x] `GET /api/v1/admin/invitations` (filtros status)
- [x] `DELETE /api/v1/admin/invitations/:id` (revoke)
- [x] `POST /api/v1/auth/accept-invitation` (público, auto-login post-aceptación)
- [x] Plantilla email `invitation.html`
- [x] Permisos: solo super_admin puede invitar a admin/super_admin

Sessions:
- [x] `GET /api/v1/admin/users/:userId/sessions`
- [x] `DELETE /api/v1/admin/sessions/:id`
- [x] `DELETE /api/v1/admin/users/:userId/sessions` (revoca todos)

### Paso 3H — OAuth providers (Google, Facebook)

- [ ] Endpoint `GET /api/v1/auth/oauth/:provider` (inicia flow)
- [ ] Endpoint `GET /api/v1/auth/oauth/:provider/callback`
- [ ] Endpoint `POST /api/v1/auth/oauth/link` (vincular cuenta existente)
- [ ] Endpoint `POST /api/v1/auth/oauth/unlink`
- [ ] Cifrar tokens del provider en `auth_providers.access_token_enc`

### Jobs / mantenimiento ✅ COMPLETADO

- [x] `cleanup-tokens` cron diario (3am) borrar tokens viejos
- [x] Advisory lock Postgres para multi-réplica
- [x] Configurable retención por tabla via `.env`
- [x] Manual run script para ad-hoc / incidentes
- [x] Audit logs con retención larga (compliance)

### Notificaciones de seguridad ✅ COMPLETADO

- [x] Email "Actividad sospechosa" tras `theft_detected` (badge rojo + detalle IP)
- [x] Email "Contraseña cambiada" tras `password.changed`
- [x] Mejor effort: si SMTP falla NO rompe flujo
- [x] Datos incluidos: when, IP, user-agent
- [x] Botones acción: cambiar password + ver sesiones

### Self-service del usuario ✅ COMPLETADO

- [x] `sid` claim en JWT (identifica sesión actual)
- [x] `PATCH /api/v1/auth/me` (edita profile cliente/admin auto-detect)
- [x] `GET /api/v1/auth/sessions` (lista propia con `is_current`)
- [x] `DELETE /api/v1/auth/sessions/:id` (revoca propia con verificación user_id)
- [x] `POST /api/v1/auth/sessions/logout-others` (preserva current)
- [x] Validación phone E.164 Bolivia en cambio
- [x] Verificación phone único anti-conflict
- [x] Audit: `user.profile.updated`, `auth.session.revoked_self`, `auth.session.logout_others`

### Paso 3J — OAuth Authorization Code Flow (SSO real) ⏳ PRÓXIMO

Convierte el MVP en **SSO real**: una sola sesión activa para todas las apps (ecommerce, soporte, crm). User loguea UNA vez en `account.gemmatex.com.bo`, las demás apps reciben tokens vía code exchange.

#### Schema nuevo

- [ ] Tabla `sso_sessions` (id, user_id, cookie_hash, ip, user_agent, expires_at, revoked_at, revoked_reason)
- [ ] Tabla `authorization_codes` (id, code_hash, sso_session_id, user_id, application_id, redirect_uri, scope, state, code_challenge, code_challenge_method, expires_at, used_at)
- [ ] FK opcional `refresh_tokens.sso_session_id` → CASCADE revoca refresh al matar sesión SSO

#### Endpoints nuevos

- [ ] `GET /api/v1/auth/authorize` — valida client_id + redirect_uri + state + PKCE, genera code, redirect
- [ ] `POST /api/v1/auth/token` — exchange code → tokens
- [ ] `POST /api/v1/auth/sso-logout` — cierra sesión SSO global + cascade revoca apps
- [ ] `GET /.well-known/openid-configuration` — OIDC discovery (opcional)
- [ ] `GET /api/v1/auth/userinfo` — OIDC userinfo (opcional, ya tenemos `/auth/me`)

#### Cookie nueva

- [ ] Cookie `sso_session` con `Domain=.gemmatex.com.bo` Path=/ SameSite=Lax HttpOnly Secure
- [ ] Vive 30 días, paralela a refresh_token cookies per-app

#### Modificaciones existentes

- [ ] `/auth/login`: además de refresh per-app, crea `sso_session` + setea cookie parent domain
- [ ] `/auth/logout`: opcional flag `sso_global=true` → equivale a `/sso-logout`
- [ ] Validation `applications.allowed_redirect_uris` debe coincidir con redirect_uri

#### Frontend account changes

- [ ] Nueva vista `/authorize` que orquesta el flow OAuth (params query)
- [ ] Botón "Cerrar sesión global" en `/sessions` → `/sso-logout`
- [ ] Lista apps autorizadas con info de sso_session

#### Endpoints admin

- [ ] `GET /api/v1/admin/sso-sessions/:userId` — listar sesiones SSO
- [ ] `DELETE /api/v1/admin/sso-sessions/:id` — force-logout global

#### Seguridad

- [ ] PKCE obligatorio (`code_challenge` S256)
- [ ] `state` validation anti-CSRF en callback
- [ ] Code TTL corto (~60 seg)
- [ ] Code 1-uso (used_at)
- [ ] redirect_uri exact match contra allowed_redirect_uris
- [ ] Rate limit en `/authorize` + `/token`

#### Migraciones requeridas

- [ ] `20XXXXXXXXXX-add-sso-sessions.js`
- [ ] `20XXXXXXXXXX-add-authorization-codes.js`
- [ ] `20XXXXXXXXXX-add-sso-session-id-to-refresh-tokens.js`

#### Docs

- [ ] `docs/flujos/oauth-code-flow.md` — flujo completo con diagramas
- [ ] `docs/api/oauth.md` — endpoints /authorize y /token detallados
- [ ] Update `docs/arquitectura/multi-app.md` con OAuth flow real

Estimado: 1-2 días backend + 1 día frontend.

### Paso 3I — Cookie httpOnly para refresh ✅ COMPLETADO

- [x] Detección automática de `application.type='spa-web'`
- [x] Setear refresh en cookie `Secure + HttpOnly + SameSite=Strict + Path=/api/v1/auth`
- [x] Endpoint `/api/v1/auth/refresh` lee de cookie O body (según tipo de app)
- [x] Endpoint `/auth/logout` limpia cookie
- [x] Schema refresh body opcional (puede venir de cookie)
- [x] `refresh_in: 'cookie'` flag en response para debug
- [x] cookie-parser middleware integrado
- [x] Env vars: `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_REFRESH_PATH`, `COOKIE_DOMAIN`
- [ ] CSRF protection (token doble-submit) — `SameSite=Strict` cubre MVP, defer defense-in-depth

## Futuro lejano

### Mejoras de escala

- [ ] PostgreSQL read replicas (queries de lectura → réplica)
- [ ] Redis para refresh token validation rápida
- [ ] Connection pooling con PgBouncer
- [ ] Logs estructurados (pino + tracing)
- [ ] Métricas Prometheus
- [ ] Health checks profundos (`/health/ready` vs `/health/live`)

### Mejoras de seguridad

- [ ] Anomaly detection (login desde país nuevo, dispositivo nuevo)
- [ ] Email de alerta tras `theft_detected`
- [ ] Dispositivos confiables (skip 2FA si dispositivo conocido)
- [ ] WebAuthn / passkeys (futuro de auth sin password)
- [ ] Hardware security keys (FIDO2)
- [ ] Geo-blocking opcional
- [ ] Captcha en endpoints sensibles (después de N fallos)

### OAuth 2.0 completo

- [ ] Endpoint `/authorize` (authorization code flow)
- [ ] Endpoint `/token` con PKCE
- [ ] OpenID Connect (`/userinfo`, `id_token`)
- [ ] OIDC Discovery `/.well-known/openid-configuration`
- [ ] Refresh token con `refresh_token` scope explícito

### Tooling

- [ ] Tests unitarios (Jest)
- [ ] Tests E2E con supertest
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Dockerfile para producción
- [ ] Helm chart para Kubernetes
- [ ] Documentación OpenAPI/Swagger autogenerada

### UX para admin

- [ ] Frontend admin (React/Vue) consumiendo el CRM
- [ ] Dashboard de auditoría con filtros y búsqueda
- [ ] Gráficos de logins, registros, fallos por día

## No haremos

Para mantener scope:

- ❌ Email marketing / newsletters (otro micro)
- ❌ Gestión de tickets de soporte (eso es el micro Tickets)
- ❌ Carrito de compras (eso es el micro E-commerce)
- ❌ Notificaciones push genéricas (otro micro)
- ❌ Pasarelas de pago (otro micro)

El SSO se mantiene como **autoridad de identidad** únicamente. Cualquier otra responsabilidad rompe el principio de single responsibility.
