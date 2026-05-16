# Documentación SSO GEMMATEX

Microservicio de Single Sign-On centralizado para las aplicaciones de GEMMATEX (E-commerce, Tickets de Soporte, CRM y futuras).

## Índice

### 🏛️ Arquitectura
- [Overview](./arquitectura/overview.md) — Qué es y por qué un SSO centralizado
- [Seguridad](./arquitectura/seguridad.md) — Argon2id, RS256, refresh rotation, rate limit
- [Multi-app](./arquitectura/multi-app.md) — Cómo el SSO sirve a varias aplicaciones

### 🗄️ Base de datos
- [Schema](./base-de-datos/schema.md) — Las 15 tablas explicadas columna por columna
- [Relaciones](./base-de-datos/relaciones.md) — Diagrama y reglas de cascada

### ⚙️ Setup
- [Instalación](./setup/instalacion.md) — Clonar, instalar, primer arranque
- [Docker](./setup/docker.md) — Postgres + pgAdmin
- [Claves RS256](./setup/claves-rs256.md) — Generar y rotar par de claves

### 🌐 API
- [Auth](./api/auth.md) — Endpoints `/auth/*`
- [Well-known](./api/well-known.md) — JWKS endpoint

### 🔁 Flujos
- [Registro](./flujos/registro.md)
- [Login + Refresh](./flujos/login-y-refresh.md)
- [Detección de robo de token](./flujos/theft-detection.md)

### 🔌 Integración
- [Cómo consumir el SSO desde otros microservicios](./integracion/otros-microservicios.md)

### 📋 Roadmap
- [Pendientes](./roadmap.md) — Email verify, SMS, 2FA, OAuth, admin

## Convenciones

- **Modelos Sequelize** → PascalCase (`User`, `RefreshToken`)
- **Tablas Postgres** → snake_case plural (`users`, `refresh_tokens`)
- **Columnas** → snake_case (`password_hash`, `created_at`)
- **PKs** → UUID v7 generados en app (lib `uuidv7`)
- **Endpoints** → kebab-case (`/auth/reset-password`)
- **Joi schemas** → camelCase exports en `src/schemas/`

## Stack

| Componente | Versión |
|---|---|
| Node.js | ≥ 20 |
| PostgreSQL | 17 |
| Express | 5.x |
| Sequelize | 6.37.x |
| Argon2id | (lib `argon2`) |
| JWT | RS256 + JWKS |
| Validación | Joi 18 |
| 2FA | otplib 13 |

## Estructura

```
src/
├── config/        env validado, db, sequelize-cli
├── db/
│   ├── models/    15 modelos Sequelize
│   ├── migrations/
│   └── seeders/
├── schemas/       Joi por feature
├── routes/        Express routers
├── controllers/   request/response
├── services/      lógica de negocio
├── middleware/    auth, validate, rate limit, error handler
├── utils/         hash, jwt, random, crypto, jwks
└── keys/          private.pem, public.pem (gitignored)
docker/            postgres init + pgAdmin config
scripts/           generate-keys.js
docs/              esta documentación
```
