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
