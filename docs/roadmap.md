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

## Próximos pasos

### Paso 3B — Verificación de email

- [ ] Service `email.service.js` (nodemailer + plantillas)
- [ ] Endpoint `POST /auth/verify-email` con token del email
- [ ] Endpoint `POST /auth/resend-verification`
- [ ] Endpoint `POST /auth/change-email` (autenticado)
- [ ] Cambiar register a `status='pending'`
- [ ] Bloquear login si email no verificado
- [ ] Plantilla HTML del email (verificación + reset)

### Paso 3C — Verificación SMS

- [ ] Service `sms.service.js` con drivers `mock` y `twilio`
- [ ] Endpoint `POST /auth/verify-phone` (con código 6 dígitos)
- [ ] Endpoint `POST /auth/resend-phone-code`
- [ ] Endpoint `POST /auth/change-phone` (autenticado)
- [ ] Activar `status='active'` solo si email + phone verificados

### Paso 3D — Password management

- [ ] Endpoint `POST /auth/forgot-password` (envía email con link)
- [ ] Endpoint `POST /auth/reset-password` (consume token)
- [ ] Endpoint `POST /auth/change-password` (autenticado)
- [ ] Aplicar `password_history` check (no reusar últimas 5)
- [ ] Revocar todos refresh tokens al cambiar password
- [ ] Email de notificación tras cambio password

### Paso 3E — 2FA TOTP

- [ ] Endpoint `POST /auth/2fa/setup` → genera secret + QR code
- [ ] Endpoint `POST /auth/2fa/enable` → confirma con código TOTP
- [ ] Endpoint `POST /auth/2fa/disable` → requiere password
- [ ] Endpoint `POST /auth/2fa/verify` durante login si `totp_enabled=true`
- [ ] Backup codes (códigos de un solo uso)
- [ ] Cifrar `totp_secret` en DB (AES-256-GCM)

### Paso 3F — API keys (service-to-service)

- [ ] Middleware `apiKey.js` que detecta prefijo `sk_` en Authorization
- [ ] Endpoint `POST /admin/applications/:id/api-keys` (crear)
- [ ] Endpoint `GET /admin/applications/:id/api-keys` (listar)
- [ ] Endpoint `DELETE /admin/api-keys/:id` (revocar)
- [ ] Endpoint `/internal/users/:id` consumido por otros micros con API key
- [ ] Sistema de scopes (`users:read`, `users:list`, etc.)

### Paso 3G — Endpoints Admin

- [ ] `GET /admin/users` (lista paginada, filtros)
- [ ] `GET /admin/users/:id`
- [ ] `PATCH /admin/users/:id` (cambiar status, roles)
- [ ] `DELETE /admin/users/:id` (soft delete)
- [ ] `POST /admin/invitations` (invitar staff)
- [ ] `GET /admin/audit-logs` (vista del registro)
- [ ] `POST /admin/applications` (crear app)
- [ ] `GET /admin/applications`
- [ ] `PATCH /admin/applications/:id`

### Paso 3H — OAuth providers (Google, Facebook)

- [ ] Endpoint `GET /auth/oauth/:provider` (inicia flow)
- [ ] Endpoint `GET /auth/oauth/:provider/callback`
- [ ] Endpoint `POST /auth/oauth/link` (vincular cuenta existente)
- [ ] Endpoint `POST /auth/oauth/unlink`
- [ ] Cifrar tokens del provider en `auth_providers.access_token_enc`

### Paso 3I — Cookie httpOnly para refresh

- [ ] Detección de `application.type='spa-web'`
- [ ] Setear refresh en cookie `Secure + HttpOnly + SameSite=Strict`
- [ ] Endpoint `/auth/refresh` lee de cookie si presente
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
