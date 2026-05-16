-- Extensiones requeridas por SSO GEMMATEX
-- Se ejecuta automáticamente al primer boot del contenedor Postgres.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pg_uuidv7 requiere build externo. Si no está disponible en la imagen,
-- el generador de UUID v7 se hace en Node (lib `uuidv7`) y esto se omite.
-- Descomenta si instalas la extensión manualmente:
-- CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
