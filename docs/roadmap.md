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
- [ ] Email de notificación tras cambio password (futuro)

### Paso 3E — 2FA TOTP

- [ ] Endpoint `POST /api/v1/auth/2fa/setup` → genera secret + QR code
- [ ] Endpoint `POST /api/v1/auth/2fa/enable` → confirma con código TOTP
- [ ] Endpoint `POST /api/v1/auth/2fa/disable` → requiere password
- [ ] Endpoint `POST /api/v1/auth/2fa/verify` durante login si `totp_enabled=true`
- [ ] Backup codes (códigos de un solo uso)
- [ ] Cifrar `totp_secret` en DB (AES-256-GCM)

### Paso 3F — API keys (service-to-service)

- [ ] Middleware `apiKey.js` que detecta prefijo `sk_` en Authorization
- [ ] Endpoint `POST /api/v1/admin/applications/:id/api-keys` (crear)
- [ ] Endpoint `GET /api/v1/admin/applications/:id/api-keys` (listar)
- [ ] Endpoint `DELETE /api/v1/admin/api-keys/:id` (revocar)
- [ ] Endpoint `/api/v1/internal/users/:id` consumido por otros micros con API key
- [ ] Sistema de scopes (`users:read`, `users:list`, etc.)

### Paso 3G — Endpoints Admin

- [ ] `GET /api/v1/admin/users` (lista paginada, filtros)
- [ ] `GET /api/v1/admin/users/:id`
- [ ] `PATCH /api/v1/admin/users/:id` (cambiar status, roles)
- [ ] `DELETE /api/v1/admin/users/:id` (soft delete)
- [ ] `POST /api/v1/admin/invitations` (invitar staff)
- [ ] `GET /api/v1/admin/audit-logs` (vista del registro)
- [ ] `POST /api/v1/admin/applications` (crear app)
- [ ] `GET /api/v1/admin/applications`
- [ ] `PATCH /api/v1/admin/applications/:id`

### Paso 3H — OAuth providers (Google, Facebook)

- [ ] Endpoint `GET /api/v1/auth/oauth/:provider` (inicia flow)
- [ ] Endpoint `GET /api/v1/auth/oauth/:provider/callback`
- [ ] Endpoint `POST /api/v1/auth/oauth/link` (vincular cuenta existente)
- [ ] Endpoint `POST /api/v1/auth/oauth/unlink`
- [ ] Cifrar tokens del provider en `auth_providers.access_token_enc`

### Paso 3I — Cookie httpOnly para refresh

- [ ] Detección de `application.type='spa-web'`
- [ ] Setear refresh en cookie `Secure + HttpOnly + SameSite=Strict`
- [ ] Endpoint `/api/v1/auth/refresh` lee de cookie si presente
- [ ] CSRF protection (token doble-submit)

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
