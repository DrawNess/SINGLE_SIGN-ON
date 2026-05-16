# Docker — Postgres + pgAdmin

`docker-compose.yml` orquesta dos servicios:

## postgres

- Imagen: `postgres:17-alpine`
- Puerto: `${DB_PORT:-5432}:5432`
- Volumen persistente: `sso_pgdata` (named volume)
- Init scripts: `docker/postgres/init/` ejecutados al **primer** boot
  - `01-extensions.sql`: instala `citext`, `pgcrypto`, `pg_trgm`
- Healthcheck con `pg_isready`
- Timezone: `America/La_Paz`

### Variables de entorno consumidas

```
DB_USER       → POSTGRES_USER
DB_PASSWORD   → POSTGRES_PASSWORD
DB_NAME       → POSTGRES_DB
DB_PORT       → puerto host
```

⚠ Postgres solo lee estas variables **en el primer boot del volumen**. Si después cambias el password en `.env`, NO se aplica al usuario existente. Para cambiar password:

```bash
docker exec sso_gemmatex_db psql -U <user> -d sso_gemmatex \
  -c "ALTER USER <user> WITH PASSWORD 'nuevo';"
```

O reset completo: `docker compose down -v && docker compose up -d`.

## pgadmin

- Imagen: `dpage/pgadmin4:latest`
- Puerto: `${PGADMIN_PORT:-8080}:80`
- Volumen: `sso_pgadmin_data`
- Modo: server mode **off** (single-user, sin contraseña maestra)
- Auto-conexión configurada

### Cómo funciona la auto-conexión

1. `docker/pgadmin/servers.json.tpl` es un template con placeholders `@@DB_HOST@@`, etc.
2. El entrypoint custom de pgAdmin:
   - Lee variables `DB_*_INTERNAL` del compose.
   - Genera `/tmp/pgpass` con credenciales reales (chmod 600).
   - Renderiza el template a `/tmp/servers.json` reemplazando placeholders.
   - Pasa `PGADMIN_SERVER_JSON_FILE=/tmp/servers.json` a pgAdmin.
3. pgAdmin al primer boot:
   - Lee `/tmp/servers.json` → ve el servidor `SSO GEMMATEX (local)`.
   - Lee `PassFile: /tmp/pgpass` → encuentra la password.
   - `ConnectNow: true` → conecta sin prompt.

Resultado: abres `http://localhost:5050`, logueas a pgAdmin, click servidor → conectado.

### Cambiar credenciales

Si cambias `DB_USER` o `DB_PASSWORD` en `.env`:

```bash
docker compose down -v     # ⚠ borra ambos volúmenes
docker compose up -d
```

`down -v` borra el volumen de pgAdmin también — necesario porque pgAdmin guarda en SQLite los servers tras primer boot, y no re-lee `servers.json` después.

## Networks

- `sso_gemmatex_net` (bridge). Ambos containers se ven entre sí.
- `pgadmin` resuelve `postgres` por hostname (DNS interno docker).
- Externamente accedes a `localhost:5432` (Postgres) y `localhost:5050` (pgAdmin) gracias a port mapping.

## Comandos útiles

```bash
# Levantar
docker compose up -d

# Logs en vivo
docker compose logs -f postgres
docker compose logs -f pgadmin

# Bajar (mantiene volúmenes)
docker compose down

# Bajar + borrar volúmenes (RESET DATOS)
docker compose down -v

# Solo reiniciar un servicio
docker compose restart pgadmin

# Conectar al Postgres CLI
docker exec -it sso_gemmatex_db psql -U <DB_USER> -d sso_gemmatex

# Ver tablas
docker exec -it sso_gemmatex_db psql -U <DB_USER> -d sso_gemmatex -c "\dt"

# Ver extensiones
docker exec -it sso_gemmatex_db psql -U <DB_USER> -d sso_gemmatex -c "\dx"
```

## Backup local (dev)

```bash
docker exec sso_gemmatex_db pg_dump -U <user> sso_gemmatex > backup.sql
```

Restore:
```bash
cat backup.sql | docker exec -i sso_gemmatex_db psql -U <user> -d sso_gemmatex
```

## Producción

⚠ El docker-compose actual es para **desarrollo local**. En producción:

- Postgres gestionado (RDS, Cloud SQL, etc.) con backup automático.
- pgAdmin solo internamente / no expuesto.
- TLS obligatorio (`DB_SSL=true`).
- Secretos en gestor (Vault, Secrets Manager, etc.) no en `.env`.
- Read replicas para queries pesadas.
- Connection pooling externo (PgBouncer) si el tráfico lo amerita.
