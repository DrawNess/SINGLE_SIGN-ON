# SSO GEMMATEX

Microservicio de Single Sign-On centralizado para las aplicaciones de GEMMATEX (Tickets de Soporte, E-commerce, CRM y futuras).

## Stack

- Node.js >= 20
- Express 5
- PostgreSQL 17 + Sequelize 6
- Joi (validación)
- Argon2id (hash de contraseñas)
- JWT RS256 + JWKS (`/.well-known/jwks.json`)
- Refresh tokens rotados con detección de robo
- 2FA TOTP (otplib)
- Verificación email (nodemailer) + SMS
- API keys para autenticación service-to-service

## Setup local

### 1. Clonar e instalar

```bash
git clone git@github.com:DrawNess/Single_Sign_On-GEMMATEX.git
cd Single_Sign_On-GEMMATEX
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
```

Edita `.env`. Genera la clave de cifrado AES-256-GCM con:

```bash
openssl rand -hex 32
```

Y pégala en `ENCRYPTION_KEY=...`.

### 3. Levantar Postgres + pgAdmin

```bash
docker compose up -d
```

- Postgres: `localhost:5432`
- pgAdmin (UI): http://localhost:8080
  - Login: `admin@gemmatex.local` / `admin` (cambiar en `.env`)
  - Servidor `SSO GEMMATEX (local)` preconfigurado. Te pedirá la password de Postgres (`sso_pass` o lo que pusiste en `DB_PASSWORD`).

### 4. Generar claves RS256 para JWT

```bash
npm run keys:generate
```

Esto crea `src/keys/private.pem` y `src/keys/public.pem`. **Nunca commitearlas.**

### 5. Migraciones y seeds (paso 2 en adelante)

```bash
npm run db:migrate
npm run db:seed:dev   # solo entorno desarrollo
```

### 6. Arrancar servidor

```bash
npm run dev
```

Servidor en http://localhost:2106.

- API versionada: `http://localhost:2106/api/v1/auth/*`
- Health: `http://localhost:2106/health`
- JWKS: `http://localhost:2106/.well-known/jwks.json`

## Scripts útiles

| Comando | Descripción |
|---|---|
| `npm run dev` | Arranca con nodemon (recarga al cambio) |
| `npm start` | Arranca en modo prod |
| `npm run lint` | ESLint |
| `npm run keys:generate` | Genera par RS256 |
| `npm run db:migrate` | Aplica migraciones pendientes |
| `npm run db:migrate:undo` | Revierte última migración |
| `npm run db:seed` | Aplica seeders prod |
| `npm run db:seed:dev` | Aplica seeders dev |
| `npm run db:reset` | Reset total (migrate undo all + migrate + seed) |

## Estructura

```
src/
├── config/        # env validado, db, sequelize-cli
├── db/
│   ├── models/    # Modelos Sequelize
│   ├── migrations/
│   └── seeders/
├── schemas/       # Joi schemas por endpoint
├── routes/
├── controllers/
├── services/      # Lógica de negocio
├── middleware/    # auth, apiKey, validate, rateLimit
├── utils/         # hash, jwt, uuid, crypto
└── keys/          # private.pem, public.pem (gitignored)
docker/postgres/init/  # Extensiones Postgres al primer boot
scripts/               # Generación de claves, etc.
```

## Apps consumidoras

El SSO expone su clave pública vía JWKS:

```
GET /.well-known/jwks.json
```

Los otros microservicios (Tickets, E-commerce, CRM) verifican localmente los JWT con esta clave pública. Para llamadas service-to-service usan API keys del SSO con el header:

```
Authorization: Bearer sk_live_xxxxxxxx...
```

## Seguridad

- Contraseñas: Argon2id (memoria 64MB, iteraciones 3)
- Tokens en DB: solo se guarda SHA-256, jamás el token plano
- Refresh tokens: rotación + `family_id` para detectar robo
- Lockout: 5 intentos fallidos → 15 min de bloqueo
- Rate limit en `/login`, `/forgot-password`, `/register`
- Helmet + CORS por origen permitido
- Política de contraseñas: no reusar las últimas 5

## Estado del proyecto

🚧 **En construcción.** Paso 1 completo: cimientos (docker, config, env, claves RS256, estructura).

Siguiente: migración inicial con las 15 tablas del schema.
