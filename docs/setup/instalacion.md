# Instalación

## Pre-requisitos

| Software | Versión mínima |
|---|---|
| Node.js | 20.x (recomendado: latest LTS) |
| Docker | 24+ con Docker Compose |
| Git | reciente |
| OS | Linux / macOS / Windows con WSL2 |

Verifica:
```bash
node -v   # debe ser >= v20
docker -v
docker compose version
```

## 1. Clonar

```bash
git clone git@github.com:DrawNess/Single_Sign_On-GEMMATEX.git
cd Single_Sign_On-GEMMATEX
```

## 2. Instalar dependencias Node

```bash
npm install
```

⚠ `argon2` compila código nativo. Si falla en Linux:
```bash
sudo pacman -S base-devel     # Arch
sudo apt install build-essential   # Ubuntu/Debian
```

## 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` y configura:

### Obligatorio cambiar

| Variable | Cómo obtener |
|---|---|
| `DB_PASSWORD` | Genera: `openssl rand -base64 24` |
| `ENCRYPTION_KEY` | Genera: `openssl rand -hex 32` |
| `MAIL_USER` | Tu cuenta SMTP |
| `MAIL_PASSWORD` | Password SMTP |
| `PGADMIN_PASSWORD` | Lo que quieras |

### Opcional

| Variable | Default | Notas |
|---|---|---|
| `PORT` | 2106 | Puerto Express |
| `DB_USER` | `sso_user` | Puedes cambiarlo |
| `JWT_ACCESS_TTL` | `15m` | Cuánto dura el access token |
| `JWT_REFRESH_TTL_DAYS` | 7 | Cuánto dura el refresh |
| `LOGIN_MAX_ATTEMPTS` | 5 | Lockout tras N intentos |
| `LOGIN_LOCKOUT_MINUTES` | 15 | Cuánto dura el bloqueo |
| `PASSWORD_HISTORY_SIZE` | 5 | Anti-reuso passwords |

## 4. Levantar Docker (Postgres + pgAdmin)

```bash
docker compose up -d
```

Verifica:
```bash
docker compose ps   # ambos deben aparecer "Up (healthy)"
```

Postgres en `localhost:5432`, pgAdmin en `http://localhost:${PGADMIN_PORT}` (default 8080, ajustable).

Ver: [Docker](./docker.md) para más detalle.

## 5. Generar claves RS256

```bash
npm run keys:generate
```

Crea `src/keys/private.pem` (chmod 600) y `src/keys/public.pem` (gitignored).

Ver: [Claves RS256](./claves-rs256.md).

## 6. Migrar la base de datos

```bash
npm run db:migrate
```

Crea las 15 tablas + enums + indexes + triggers.

## 7. Seeds

```bash
# Seed obligatorio: roles (client, staff, admin, super_admin)
npm run db:seed

# Seed solo desarrollo: applications + super_admin con password aleatoria
npm run db:seed:dev

# O combo
npm run db:seed:full-dev
```

⚠ El comando `db:seed:dev` **imprime UNA VEZ** en consola:
- `client_secret` de la app Tickets
- Password aleatoria del super_admin

Guárdalas (no se muestran de nuevo).

## 8. Arrancar el servidor

```bash
npm run dev
```

Salida esperada:
```
✔ sso-gemmatex (development)
✔ Servidor en http://localhost:2106
✔ Health:   http://localhost:2106/health
✔ JWKS:     http://localhost:2106/.well-known/jwks.json
```

## 9. Verificación rápida

```bash
curl http://localhost:2106/health
```

Esperado:
```json
{
  "status": "ok",
  "service": "sso-gemmatex",
  "env": "development",
  "db": "connected",
  "counts": { "users": 1, "roles": 4, "applications": 3 },
  "timestamp": "..."
}
```

## Reset completo (dev)

Si quieres empezar desde cero:

```bash
docker compose down -v       # ⚠ borra DB completa
docker compose up -d
npm run db:migrate
npm run db:seed:full-dev
```

Solo para dev. **Nunca en prod.**

## Comandos npm disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | Arranca con nodemon (recarga al cambio) |
| `npm start` | Modo producción |
| `npm run lint` | ESLint |
| `npm run keys:generate` | Genera par RS256 |
| `npm run db:migrate` | Aplica migraciones pendientes |
| `npm run db:migrate:undo` | Revierte última migración |
| `npm run db:seed` | Aplica seeders prod (roles) |
| `npm run db:seed:dev` | Aplica seeders dev (apps + admin) |
| `npm run db:seed:full-dev` | Combo: prod + dev |
| `npm run db:reset` | Reset total |
