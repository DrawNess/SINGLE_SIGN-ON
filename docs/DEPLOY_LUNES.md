# Plan deploy SSO a VPS — Lunes 2026-06-08

> Documento puente entre sesiones. Pausa: 2026-06-03 (oficina). Resume: 2026-06-08 (casa).
> Leer todo antes de ejecutar. Cargar este archivo al iniciar nueva sesión de Claude.

---

## Contexto rápido para Claude (lectura inicial)

Si abrís Claude Code nuevo en esta carpeta:
1. Leé este archivo completo.
2. Leé también: `docs/integracion/api-v6.md`, `docs/roadmap.md`.
3. Verificá estado actual: `git log -5 --oneline`, `npm audit`, `git status`.
4. NO ejecutar pasos sin confirmar con usuario — quiere supervisar todo.

## Decisión tomada

**Desplegar SSO en el mismo VPS** (no servidor separado).

**Razón:** VPS tiene 6.9GB RAM libre, 2 cores, 89GB disco libre, Postgres 16 y PM2 ya corriendo.

## Recursos VPS (snapshot 2026-06-03)

| Recurso | Valor |
|---------|-------|
| IP | `<VPS_IP>` (ver password manager) |
| User SSH | `root` (pass en password manager) |
| RAM | 7.8GB total / 6.9GB libre |
| CPU | 2 cores |
| Disco | 96GB (8% usado) |
| Swap | **0B — crear 2GB primero** |
| Stack | Postgres 16, PM2 v6, Node (API-V6 viejo) |

## Trabajo ya hecho (no rehacer)

- [x] Frontend Angular: bugs/security crit+med arreglados
- [x] Página `/mi-cuenta/seguridad` (cambio password + sesiones)
- [x] API-V6: 11 routers migrados `passport-jwt` → `ssoAuth`
- [x] Admin SSO local con pass conocido (ver password manager)
- [x] Scripts migración: `scripts/migrate-prod-users.js`, `scripts/migrate-prod-orders.js`
- [x] Datos prod exportados localmente
- [x] Vuln uuid arreglada con `overrides` en package.json (`uuid@^11.1.1`)

## Plan paso-a-paso

### 1. Swap 2GB en VPS (mitiga OOM por argon2)
```bash
ssh root@<VPS_IP>
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
```

### 2. DB SSO en Postgres existente
```bash
sudo -u postgres psql -h localhost
CREATE DATABASE sso_gemmatex OWNER postgres;
\q
```

### 3. Clonar SSO al VPS
```bash
cd /root/Gemmatex
git clone git@github.com:DrawNess/Single_Sign_On-GEMMATEX.git sso
cd sso
npm ci
```

### 4. `.env` producción
Generar keys NUEVAS (no reusar dev):
```bash
npm run keys:generate
```

Variables mínimas:
```
NODE_ENV=production
PORT=2106
DB_HOST=localhost DB_PORT=5432 DB_NAME=sso_gemmatex DB_USER=postgres DB_PASSWORD=<pass VPS>
JWT_PRIVATE_KEY_PATH=keys/private.pem
JWT_PUBLIC_KEY_PATH=keys/public.pem
SMTP_HOST=<...> SMTP_PORT=<...> SMTP_USER=<...> SMTP_PASS=<...>
CORS_ORIGINS=https://account.gemmatex.com.bo,https://gemmatex.com.bo
COOKIE_DOMAIN=.gemmatex.com.bo
BASE_URL=https://sso.gemmatex.com.bo
```

### 5. Migrate + seed
```bash
npm run db:migrate
npm run db:seed   # NO usar db:seed:full-dev
```
**Capturar admin password impreso UNA vez.**

### 6. PM2
```bash
pm2 start index.js --name sso
pm2 save
```

### 7. Nginx + TLS
- DNS: crear A record `sso.gemmatex.com.bo` → `<VPS_IP>`
- Nginx config: `proxy_pass http://localhost:2106`
- `certbot --nginx -d sso.gemmatex.com.bo`
- Smoke: `curl https://sso.gemmatex.com.bo/health`

### 8. Migrar 119 usuarios
Editar `scripts/migrate-prod-users.js`:
- `SSO_URL = 'https://sso.gemmatex.com.bo/api/v1'`
- `SSO_CLIENT_ID = 'app_ecommerce_prod'` (verificar seeder lo crea)

```bash
node scripts/migrate-prod-users.js --dry-run
node scripts/migrate-prod-users.js
```

Genera `migration-mapping.json` con UUIDs SSO.

### 9. Migrar 33 órdenes
```bash
node scripts/migrate-prod-orders.js > /tmp/orders_migration.sql
# Revisar SQL antes de ejecutar
# Copiar al VPS y ejecutar contra DB del API-V6 NUEVO
```

### 10. Deploy API-V6 integrado
```bash
cd /root/Gemmatex/api-v6
git pull origin <rama-integrada>
# Asegurar .env apunta a https://sso.gemmatex.com.bo
pm2 restart api-v6
```

### 11. Reset emails (último paso)
```bash
node scripts/migrate-prod-users.js --send-reset
```

## Bloqueadores a resolver antes

- [ ] **Pass postgres del VPS** — buscar en API-V6 viejo `.env`
- [ ] **SMTP credenciales prod** — usuario debe proveerlas
- [ ] **DNS `sso.gemmatex.com.bo`** — usuario debe crear A record
- [ ] **client `app_ecommerce_prod`** — verificar seeder lo crea o agregarlo

## Credenciales referencia

> **NO commitear credenciales en este doc.** Guardar en password manager. Acá solo nombres de variables.

| Sistema | Variables a tener listas |
|---------|--------------------------|
| VPS SSH | `VPS_IP`, `VPS_ROOT_PASS` |
| Prod DB vieja (export) | `PROD_DB_HOST` (localhost en VPS), `PROD_DB_PORT`, `PROD_DB_USER`, `PROD_DB_PASS`, `PROD_DB_NAME` |
| SSO DB nueva | misma instancia Postgres VPS, DB `sso_gemmatex` |
| Admin SSO local actual | `<en password manager>` |

## Archivos clave

- `scripts/migrate-prod-users.js`
- `scripts/migrate-prod-orders.js`
- `package.json` (overrides uuid@11)
- `docs/integracion/api-v6.md`

---

## Smoke tests por paso

> Ejecutar cada smoke test antes de avanzar al siguiente paso. Si falla → revisar logs y rollback.

### Paso 1 (swap)
```bash
swapon --show
free -h | grep Swap   # debe mostrar 2.0Gi
```

### Paso 2 (DB SSO)
```bash
sudo -u postgres psql -h localhost -lqt | grep sso_gemmatex
# Debe listar la DB
```

### Paso 3 (clone + npm ci)
```bash
cd /root/Gemmatex/sso
node -e "require('./package.json')" && echo OK
ls keys/ 2>/dev/null || echo "keys no generadas aún"
```

### Paso 4 (env + keys)
```bash
test -f keys/private.pem && test -f keys/public.pem && echo "keys OK"
node -e "require('dotenv').config(); console.log('PORT:', process.env.PORT)"
```

### Paso 5 (migrate + seed)
```bash
sudo -u postgres psql -h localhost -d sso_gemmatex -c "\dt"
# Debe listar: users, applications, roles, refresh_tokens, audit_logs, etc.
sudo -u postgres psql -h localhost -d sso_gemmatex -c "SELECT COUNT(*) FROM applications;"
# Debe ser >= 1 (super_admin app)
```

### Paso 6 (PM2)
```bash
pm2 status sso   # debe estar 'online'
pm2 logs sso --lines 50 --nostream   # buscar "SSO listening on :2106"
curl -s http://localhost:2106/health   # debe responder 200
```

### Paso 7 (Nginx + TLS)
```bash
curl -sI https://sso.gemmatex.com.bo/health
# Debe ser HTTP/2 200 con Strict-Transport-Security header
curl -s https://sso.gemmatex.com.bo/.well-known/jwks.json | jq .
# Debe responder JWKS con kid del .env
```

### Paso 8 (migración usuarios)
- Dry-run: revisar log "Usuarios encontrados en prod: 119"
- Real: verificar `migration-mapping.json` tiene 119 entries con `sso_uuid` válido
```bash
jq '.mapping | length' migration-mapping.json
sudo -u postgres psql -h localhost -d sso_gemmatex -c "SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '1 hour';"
# Debe ser 119 (+ admin del seed)
```

### Paso 9 (migración órdenes)
```bash
# Después de ejecutar el SQL en DB API-V6 nuevo:
psql ... -c "SELECT COUNT(*) FROM orders WHERE created_at < NOW() - INTERVAL '1 day';"
# Debe ser 33 (las históricas)
```

### Paso 10 (API-V6 integrado)
```bash
pm2 logs api-v6 --lines 50 --nostream   # sin errores SSO conexión
# Test login desde frontend prod → debe redirigir / iniciar sesión OK
```

### Paso 11 (reset emails)
- Verificar 1 email llegó (probar con cuenta propia primero)
- Si OK → correr para los 119
- Monitorear logs SMTP por bouncebacks

---

## Rollback por paso

### Paso 1 falla
```bash
swapoff /swapfile && rm /swapfile
sed -i '/swapfile/d' /etc/fstab
```

### Paso 2 falla / DB corrupta
```bash
sudo -u postgres psql -h localhost -c "DROP DATABASE sso_gemmatex;"
```

### Paso 5 falla a mitad (migraciones rotas)
```bash
cd /root/Gemmatex/sso
npm run db:migrate:undo   # repetir hasta vaciar
# Luego: revisar migración rota, fix, retry
```

### Paso 6-7 falla (SSO no arranca / Nginx)
```bash
pm2 stop sso && pm2 delete sso
# Si DNS/cert mal: corregir antes de retry. NO destruye datos.
```

### Paso 8 falla a mitad (algunos users creados, otros no)
- **NO correr el script de nuevo sin filtrar**, los ya creados darán 409 (manejado, los marca skipped)
- Revisar `migration-mapping.json` → contiene los OK
- Para los failed: investigar error en el log, fix individualmente
- **Si se quiere abortar TODO**: drop & recrear DB sso_gemmatex, re-migrar + re-seed, re-correr migration

### Paso 9 falla (SQL órdenes)
- BEGIN/COMMIT en el SQL generado → si falla, hace ROLLBACK automático. Datos íntegros.
- Revisar error, fix, regenerar SQL, retry.

### Paso 10 falla (API-V6 no levanta)
```bash
cd /root/Gemmatex/api-v6
git reset --hard <hash-version-vieja>   # SOLO si versión vieja todavía funciona
pm2 restart api-v6
```
**Antes**: hacer backup de `.env` viejo + tag git de versión vieja.

### Paso 11 falla (SMTP)
- NO crítico — usuarios pueden pedir reset manualmente desde /forgot-password
- Comunicar a usuarios via canal alternativo (Whatsapp grupo, etc) que tienen que hacer reset

---

## `.env` template completo producción

> Copiar a `/root/Gemmatex/sso/.env` y llenar valores `<...>`.

```bash
# --- App ---
NODE_ENV=production
PORT=2106
APP_NAME=sso-gemmatex
APP_URL=https://sso.gemmatex.com.bo
LOG_LEVEL=info

# --- Base de datos Postgres ---
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=<pass postgres VPS>
DB_NAME=sso_gemmatex
DB_POOL_MAX=10
DB_POOL_MIN=0
DB_POOL_IDLE=10000

# --- JWT RS256 ---
JWT_PRIVATE_KEY_PATH=./src/keys/private.pem
JWT_PUBLIC_KEY_PATH=./src/keys/public.pem
JWT_ISSUER=sso.gemmatex.com.bo
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=7
JWT_KID=key-2026-06

# --- Encryption ---
# Generar: openssl rand -hex 32
ENCRYPTION_KEY=<64 chars hex>

# --- Mail SMTP ---
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USER=<usuario SMTP>
MAIL_PASSWORD=<pass SMTP>
MAIL_FROM_NAME=GEMMATEX SSO
MAIL_FROM_EMAIL=no-reply@gemmatex.com.bo
MAIL_LOGO_URL=https://peru-crane-813567.hostingersite.com/Logos/Logo%20gemmatex%20azul.png
MAIL_BRAND_COLOR="#0b5ed7"
MAIL_FOOTER_LOCATION=La Paz – Bolivia

# --- URLs frontend prod ---
EMAIL_VERIFY_URL_TEMPLATE=https://account.gemmatex.com.bo/verify-email?token={token}
EMAIL_CHANGE_URL_TEMPLATE=https://account.gemmatex.com.bo/confirm-email-change?token={token}
EMAIL_RESET_URL_TEMPLATE=https://account.gemmatex.com.bo/reset-password?token={token}
EMAIL_INVITATION_URL_TEMPLATE=https://account.gemmatex.com.bo/accept-invitation?token={token}

# --- SMS (deferred, mock por ahora) ---
SMS_PROVIDER=mock
SMS_FROM=+59100000000

# --- Tokens y seguridad ---
PASSWORD_HISTORY_SIZE=5
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
EMAIL_VERIFY_TTL_HOURS=24
PHONE_VERIFY_TTL_MINUTES=10
PHONE_VERIFY_MAX_ATTEMPTS=5
PASSWORD_RESET_TTL_HOURS=1
ADMIN_INVITE_TTL_DAYS=7

# --- Rate limit ---
RATE_LIMIT_LOGIN_PER_MIN=5
RATE_LIMIT_FORGOT_PER_HOUR=3
RATE_LIMIT_REGISTER_PER_HOUR=10

# --- CORS prod ---
CORS_ORIGINS=https://account.gemmatex.com.bo,https://gemmatex.com.bo

# --- Jobs ---
JOBS_ENABLED=true
JOBS_CLEANUP_TOKENS_CRON=0 3 * * *
JOBS_CLEANUP_REFRESH_TOKENS_DAYS=90
JOBS_CLEANUP_EMAIL_TOKENS_DAYS=30
JOBS_CLEANUP_PASSWORD_RESETS_DAYS=30
JOBS_CLEANUP_PHONE_VERIFICATIONS_DAYS=30
JOBS_CLEANUP_AUDIT_LOGS_DAYS=365

# --- Cookies prod (HTTPS obligatorio) ---
COOKIE_SECURE=true
COOKIE_SAMESITE=strict
COOKIE_REFRESH_PATH=/api/v1/auth
COOKIE_DOMAIN=.gemmatex.com.bo
```

**Valores nuevos a generar:**
- `ENCRYPTION_KEY`: `openssl rand -hex 32`
- `JWT_KID`: nombre nuevo (ej `key-2026-06`) — NO reutilizar el de dev
- `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH`: generadas con `npm run keys:generate`
