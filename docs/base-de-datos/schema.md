# Schema de Base de Datos

15 tablas Postgres 17. PKs UUID v7 (generadas en app vía lib `uuidv7`).

## Convenciones generales

- **snake_case** para tablas y columnas.
- **Plural** para tablas (`users`, `refresh_tokens`).
- **Timestamps**: `created_at`, `updated_at` (timestamptz), trigger `set_updated_at()` automático.
- **Soft delete** via `deleted_at` en `users` y `applications` (Sequelize `paranoid: true`).
- **Tokens**: nunca en plano. Se guarda `sha256(token)` o hash Argon2.

## Enums Postgres

| Enum | Valores |
|---|---|
| `enum_users_status` | `pending`, `active`, `suspended`, `deleted` |
| `enum_applications_type` | `spa-web`, `mobile`, `desktop`, `service` |
| `enum_client_profiles_document_type` | `CI`, `NIT` |
| `enum_client_profiles_departamento` | 9 departamentos de Bolivia |
| `enum_auth_providers_provider` | `google`, `facebook`, `microsoft` |
| `enum_refresh_tokens_revoked_reason` | `logout`, `rotation`, `theft_detected`, `admin`, `password_changed` |
| `enum_audit_logs_actor_type` | `user`, `admin`, `system`, `api_key` |

---

## 1. `users` — núcleo de autenticación

Datos mínimos para autenticar. NO contiene nombre/apellido (eso va en `client_profiles` o `admin_profiles`).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID v7 PK | |
| `email` | citext UNIQUE NOT NULL | case-insensitive |
| `password_hash` | varchar(255) NULL | Argon2id. NULL solo si autenticación OAuth pura |
| `status` | enum NOT NULL | `pending`/`active`/`suspended`/`deleted` |
| `email_verified_at` | timestamptz NULL | |
| `failed_login_attempts` | int NOT NULL DEFAULT 0 | lockout counter |
| `locked_until` | timestamptz NULL | bloqueo temporal |
| `last_login_at` | timestamptz NULL | |
| `last_login_ip` | inet NULL | |
| `password_changed_at` | timestamptz NULL | |
| `totp_secret` | varchar(255) NULL | 2FA cifrado |
| `totp_enabled` | bool NOT NULL DEFAULT false | |
| `created_at`/`updated_at`/`deleted_at` | timestamptz | soft delete activo |

**Índices**:
- UNIQUE(`email`)
- idx(`status`), idx(`deleted_at`), idx(`locked_until`)
- Índice parcial: `idx_users_active ON users(email) WHERE deleted_at IS NULL AND status='active'`

---

## 2. `roles` — catálogo

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `name` | varchar(50) UNIQUE NOT NULL |
| `description` | text |
| `is_system` | bool — impide borrar desde UI si true |
| `created_at`/`updated_at` | timestamptz |

**Seed**: `client`, `staff`, `admin`, `super_admin` (todos `is_system=true`).

---

## 3. `user_roles` — M:N users ↔ roles

| Columna | Tipo |
|---|---|
| `user_id` | UUID FK users ON DELETE CASCADE |
| `role_id` | UUID FK roles ON DELETE RESTRICT |
| `assigned_at` | timestamptz |
| `assigned_by` | UUID FK users SET NULL |

**PK compuesta**: (`user_id`, `role_id`).

---

## 4. `client_profiles` — datos de cliente final

1:1 con `users`. Solo para usuarios con rol `client`.

| Columna | Tipo | Notas |
|---|---|---|
| `user_id` | UUID PK FK users CASCADE | |
| `first_name` | varchar(100) NOT NULL | |
| `last_name` | varchar(100) NOT NULL | |
| `phone` | varchar(13) NOT NULL UNIQUE | **+591########** (CHECK constraint) |
| `phone_verified_at` | timestamptz NULL | |
| `document_type` | enum `CI`/`NIT` NULL | |
| `document_number` | varchar(20) UNIQUE NULL | |
| `birth_date` | date NULL | |
| `razon_social` | varchar(200) NULL | obligatorio si `document_type='NIT'` |
| `departamento` | enum NOT NULL | 9 deptos Bolivia |
| `provincia` | varchar(100) NOT NULL | |
| `ciudad` | varchar(100) NOT NULL | |
| `calle_avenida` | varchar(200) NOT NULL | |
| `numero` | varchar(20) NOT NULL | |
| `casa_dpto` | varchar(50) NULL | |
| `link_google_maps` | text NULL | |
| `country` | varchar(2) NOT NULL DEFAULT 'BO' | reservado expansión |
| `created_at`/`updated_at` | timestamptz | |

**CHECKs**:
- `phone ~ '^\+591[0-9]{8}$'`
- NIT requiere razon_social

---

## 5. `admin_profiles` — datos de staff/admin

1:1 con `users`. Para `staff`, `admin`, `super_admin`.

| Columna | Tipo |
|---|---|
| `user_id` | UUID PK FK users CASCADE |
| `first_name` | varchar(100) NOT NULL |
| `last_name` | varchar(100) NOT NULL |
| `job_title` | varchar(100) NULL |
| `department` | varchar(100) NULL |
| `employee_code` | varchar(50) UNIQUE NULL |
| `phone` | varchar(20) NULL |
| `created_at`/`updated_at` | timestamptz |

---

## 6. `applications` — apps consumidoras del SSO

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID v7 PK | |
| `name` | varchar(100) UNIQUE NOT NULL | slug: `tickets-soporte` |
| `display_name` | varchar(150) NOT NULL | UI: `Tickets de Soporte` |
| `client_id` | varchar(100) UNIQUE NOT NULL | público: `app_tickets_dev` |
| `client_secret_hash` | varchar(255) NULL | Argon2. NULL si tipo `spa-web` |
| `type` | enum NOT NULL | |
| `audience` | varchar(100) NOT NULL | claim `aud` JWT |
| `allowed_origins` | text[] | CORS |
| `allowed_redirect_uris` | text[] | futuro OAuth flow |
| `is_active` | bool NOT NULL DEFAULT true | |
| `created_by` | UUID FK users SET NULL | |
| `created_at`/`updated_at`/`deleted_at` | soft delete |

**CHECK**:
```sql
CHECK (
  (type = 'spa-web' AND client_secret_hash IS NULL)
  OR (type IN ('mobile','desktop','service') AND client_secret_hash IS NOT NULL)
)
```

---

## 7. `api_keys` — service-to-service

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `application_id` | UUID FK applications CASCADE |
| `name` | varchar(100) — ej `tickets-backend-prod` |
| `key_prefix` | varchar(16) — visible: `sk_live_a1b2` |
| `key_hash` | varchar(255) UNIQUE — SHA-256 del full key |
| `scopes` | text[] — ej `{users:read, users:write}` |
| `last_used_at` | timestamptz |
| `last_used_ip` | inet |
| `expires_at` | timestamptz NULL |
| `revoked_at` | timestamptz NULL |
| `created_by` | UUID FK users SET NULL |
| `created_at` | timestamptz |

---

## 8. `auth_providers` — OAuth futuro

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `user_id` | UUID FK users CASCADE |
| `provider` | enum |
| `provider_user_id` | varchar(255) |
| `email` | citext NULL |
| `access_token_enc` | text NULL — AES-256-GCM |
| `refresh_token_enc` | text NULL |
| `token_expires_at` | timestamptz NULL |
| `profile_data` | jsonb NULL |
| `linked_at` | timestamptz |
| `created_at`/`updated_at` | |

**UNIQUE**: (`provider`, `provider_user_id`).

---

## 9. `refresh_tokens` — rotación + family

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID v7 PK | |
| `user_id` | UUID FK users CASCADE | |
| `application_id` | UUID FK applications NOT NULL | qué app emitió |
| `token_hash` | varchar(255) UNIQUE — SHA-256 | |
| `family_id` | UUID — agrupa rotaciones | |
| `expires_at` | timestamptz | |
| `revoked_at` | timestamptz NULL | |
| `revoked_reason` | enum | |
| `replaced_by` | UUID FK self SET NULL | sucesor tras rotación |
| `ip` | inet | |
| `user_agent` | text | |
| `created_at` | timestamptz | |

---

## 10. `email_verifications`

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `user_id` | UUID FK users CASCADE |
| `token_hash` | varchar(255) UNIQUE — SHA-256 |
| `email` | citext NOT NULL |
| `new_email` | citext NULL — para flujo cambio email |
| `expires_at` | timestamptz NOT NULL |
| `used_at` | timestamptz NULL |
| `created_at` | timestamptz |

---

## 11. `phone_verifications` — SMS

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `user_id` | UUID FK users CASCADE |
| `phone` | varchar(13) — formato E.164 +591 |
| `code_hash` | varchar(255) — SHA-256 del código 6 dígitos |
| `attempts` | int DEFAULT 0 — max 5 |
| `expires_at` | timestamptz |
| `used_at` | timestamptz NULL |
| `created_at` | timestamptz |

---

## 12. `password_resets`

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `user_id` | UUID FK users CASCADE |
| `token_hash` | varchar(255) UNIQUE |
| `expires_at` | timestamptz |
| `used_at` | timestamptz NULL |
| `ip` | inet |
| `user_agent` | text |
| `created_at` | timestamptz |

---

## 13. `password_history`

Últimas N contraseñas hasheadas (Argon2id). Política anti-reuso.

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `user_id` | UUID FK users CASCADE |
| `password_hash` | varchar(255) |
| `created_at` | timestamptz |

`PASSWORD_HISTORY_SIZE=5` (configurable). Al cambiar password, se compara contra las últimas 5.

---

## 14. `admin_invitations`

Super admin invita staff via email.

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `email` | citext NOT NULL |
| `invited_role_id` | UUID FK roles RESTRICT |
| `token_hash` | varchar(255) UNIQUE |
| `invited_by` | UUID FK users RESTRICT |
| `expires_at` | timestamptz |
| `accepted_at` | timestamptz NULL |
| `accepted_user_id` | UUID FK users SET NULL |
| `revoked_at` | timestamptz NULL |
| `created_at`/`updated_at` | |

---

## 15. `audit_logs`

Auditoría completa. Cada evento de seguridad queda aquí.

| Columna | Tipo |
|---|---|
| `id` | UUID v7 PK |
| `user_id` | UUID FK users SET NULL — sujeto |
| `actor_id` | UUID FK users SET NULL — quién hizo la acción |
| `actor_type` | enum `user`/`admin`/`system`/`api_key` |
| `api_key_id` | UUID FK api_keys SET NULL |
| `application_id` | UUID FK applications SET NULL |
| `action` | varchar(100) — ej `auth.login.success` |
| `entity` | varchar(100) NULL — tabla afectada |
| `entity_id` | UUID NULL |
| `metadata` | jsonb NULL |
| `ip` | inet |
| `user_agent` | text |
| `created_at` | timestamptz |

**Índices**:
- (`user_id`, `created_at DESC`)
- (`actor_id`)
- (`action`)
- (`created_at DESC`)
- GIN(`metadata`)

⚠ Las FKs a `users` son `ON DELETE SET NULL` — borrar un usuario NO destruye su historial de auditoría.
