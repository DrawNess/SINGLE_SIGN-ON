# API — Admin endpoints

Endpoints para gestión administrativa del SSO. Bajo `/api/v1/admin/*`.

**Todos requieren** `Authorization: Bearer <jwt>` + rol `admin` o `super_admin`.

## Permisos por rol

| Acción | admin | super_admin |
|---|---|---|
| Listar / ver users | ✓ | ✓ |
| Suspender / activar clientes | ✓ | ✓ |
| Soft delete users | ✓ | ✓ |
| Restaurar users | ✓ | ✓ |
| Asignar rol `client`/`staff` | ✓ | ✓ |
| Asignar rol `admin`/`super_admin` | ❌ | ✓ |
| Ver audit logs | ✓ | ✓ |
| Ver stats | ✓ | ✓ |

---

## GET `/api/v1/admin/stats`

Dashboard counts.

### Respuesta 200
```json
{
  "users": { "total": 5, "active": 3, "pending": 2, "suspended": 0 },
  "roles": 4,
  "applications": 3,
  "sessions": { "active_refresh_tokens": 11 },
  "audit": { "events_last_24h": 21 }
}
```

---

## GET `/api/v1/admin/users`

Lista paginada con filtros.

### Query params
| Param | Tipo | Default |
|---|---|---|
| `page` | int ≥1 | 1 |
| `page_size` | int 1-100 | 20 |
| `status` | `pending`/`active`/`suspended`/`deleted` | — |
| `role` | `client`/`staff`/`admin`/`super_admin` | — |
| `q` | string (search en email, mín 2 chars) | — |
| `include_deleted` | bool | false |

### Respuesta 200
```json
{
  "items": [
    {
      "id": "019e...",
      "email": "juan@test.bo",
      "status": "active",
      "email_verified_at": "...",
      "last_login_at": "...",
      "clientProfile": { "first_name": "Juan", "last_name": "Perez", "phone": "+59172..." },
      "adminProfile": null,
      "roles": ["client"],
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 5,
    "total_pages": 1
  }
}
```

---

## GET `/api/v1/admin/users/:id`

Detalle de un usuario con perfiles + roles + metadata de asignación.

### Respuesta 200
```json
{
  "user": {
    "id": "019e...",
    "email": "...",
    "status": "active",
    "clientProfile": { /* todos los campos */ },
    "adminProfile": null,
    "roles": [
      {
        "id": "...",
        "name": "client",
        "user_roles": { "assigned_at": "...", "assigned_by": "..." }
      }
    ]
  }
}
```

### Errores
- `404 NotFound`

---

## PATCH `/api/v1/admin/users/:id`

Cambia status y/o roles de un usuario.

### Body
```json
{
  "status": "suspended",
  "roles": ["client", "staff"]
}
```

Al menos uno de `status` o `roles` requerido.

### Efectos

- Si `status='suspended'` → revoca todos los refresh tokens activos del user.
- Si `roles` incluye `admin`/`super_admin` → requiere actor sea `super_admin`.
- `roles` es **reemplazo total** (no merge): los roles que no estén en el array se quitan.
- `audit_logs` registra cambios en `metadata`.

### Errores
- `400 BadRequest` — auto-modificación de status, o body vacío
- `400 BadRequest` — rol no existe
- `403 Forbidden` — admin intentando asignar admin/super_admin
- `404 NotFound`

---

## DELETE `/api/v1/admin/users/:id`

Soft delete (paranoid). Setea `deleted_at` + `status='deleted'`. Revoca todos los refresh tokens.

### Respuesta 204

### Errores
- `400 BadRequest` — auto-borrado
- `404 NotFound`

---

## POST `/api/v1/admin/users/:id/restore`

Restaura un user soft-deleted. Reseta `deleted_at = NULL` + `status='active'`.

### Respuesta 200
```json
{ "user": { /* detalle restaurado */ } }
```

### Errores
- `400 BadRequest` — user no estaba eliminado
- `404 NotFound`

---

## GET `/api/v1/admin/audit-logs`

Lista paginada de eventos de auditoría.

### Query params
| Param | Tipo | Notas |
|---|---|---|
| `page` | int ≥1 | |
| `page_size` | int 1-100 | |
| `user_id` | UUID v7 | filtra por sujeto |
| `actor_id` | UUID v7 | filtra por actor |
| `action` | string | match exacto: `auth.login.success` |
| `action_prefix` | string | prefijo: `auth.login.` para login.success + login.failed |
| `from` | ISO date | desde |
| `to` | ISO date | hasta (debe ser > from) |

### Respuesta 200
```json
{
  "items": [
    {
      "id": "...",
      "user_id": "...",
      "actor_id": "...",
      "actor_type": "user",
      "action": "auth.login.success",
      "entity": null,
      "entity_id": null,
      "metadata": null,
      "ip": "::1",
      "user_agent": "curl/8.x",
      "created_at": "..."
    }
  ],
  "pagination": { /* ... */ }
}
```

---

## Audit actions registradas por endpoints admin

| Endpoint | Action |
|---|---|
| `PATCH /users/:id` | `admin.user.updated` |
| `DELETE /users/:id` | `admin.user.deleted` |
| `POST /users/:id/restore` | `admin.user.restored` |

Cada uno con `actor_type='admin'`, `entity='users'`, `entity_id=user.id` y `metadata` con diff de cambios.

---

## Applications

### GET `/api/v1/admin/applications`

Lista paginada de applications.

Query: `page`, `page_size`, `type`, `is_active`, `q` (busca en name/display_name/client_id), `include_deleted`.

### POST `/api/v1/admin/applications`

Crea una nueva application. Si `type != 'spa-web'`, genera `client_secret` automáticamente.

#### Body
```json
{
  "name": "facturacion-backend",
  "display_name": "Facturación Backend",
  "client_id": "app_facturacion_prod",
  "type": "service",
  "audience": "facturacion",
  "allowed_origins": [],
  "allowed_redirect_uris": [],
  "is_active": true
}
```

#### Respuesta 201
```json
{
  "application": { /* ... */ },
  "client_secret": "hBaxMpw5YkXARE3WShov5P_JpnjyKeF2...",
  "warning": "Guarda este client_secret AHORA. No se mostrará otra vez."
}
```

⚠ `client_secret` solo aparece UNA VEZ. Si lo pierdes, debes rotar.

### GET `/api/v1/admin/applications/:id`
Detalle. `client_secret_hash` excluido por `toJSON()`.

### PATCH `/api/v1/admin/applications/:id`
Body con cualquiera de: `display_name`, `audience`, `allowed_origins`, `allowed_redirect_uris`, `is_active`.

### DELETE `/api/v1/admin/applications/:id`
Soft delete (paranoid).

### POST `/api/v1/admin/applications/:id/rotate-secret`
Genera nuevo `client_secret`. Devuelve plano una vez. Aplicable solo a apps `type != spa-web`.

---

## Invitations

### POST `/api/v1/admin/invitations`

Invita a un email para registrarse como staff/admin. Envía email con link a `account.gemmatex.com.bo/accept-invitation?token=...`.

#### Body
```json
{ "email": "nuevo.staff@gemmatex.com.bo", "role": "staff" }
```

#### Restricciones
- Solo `super_admin` puede invitar a `admin` o `super_admin`.
- Email no debe estar ya registrado.
- Invita previas a mismo email se revocan automáticamente.

#### Respuesta 201
```json
{
  "invitation": {
    "id": "...",
    "email": "...",
    "invited_role_id": "...",
    "expires_at": "...",
    "accepted_at": null,
    "revoked_at": null
  }
}
```

### GET `/api/v1/admin/invitations`

Lista con filtros. Query: `page`, `page_size`, `status` (`pending`/`accepted`/`revoked`/`expired`), `email`.

### DELETE `/api/v1/admin/invitations/:id`
Revoca una invitación pendiente.

---

## Sessions

### GET `/api/v1/admin/users/:userId/sessions`

Refresh tokens del usuario. Query `include_revoked=true` muestra todos. Default solo activos.

### DELETE `/api/v1/admin/sessions/:id`
Force-logout de un dispositivo específico.

### DELETE `/api/v1/admin/users/:userId/sessions`
Force-logout de TODOS los dispositivos de un user.

Respuesta:
```json
{ "revoked": 5 }
```

---

## Accept invitation (público, en /auth)

### POST `/api/v1/auth/accept-invitation`

NO requiere auth (el token es la credencial). Crea cuenta admin/staff con datos del invitado y devuelve par de tokens (login automático).

#### Headers
```
Content-Type: application/json
X-Client-Id: app_crm_dev
```

#### Body
```json
{
  "token": "35X8ajgFSvt5Zg1EeUqaZloddcXsWOocSwGGuHndZRU",
  "password": "Segura123",
  "first_name": "Nuevo",
  "last_name": "Staff",
  "job_title": "Soporte Técnico",
  "department": "IT",
  "phone": "+59172000123"
}
```

#### Respuesta 201
Mismo formato que login: `{ user, access_token, refresh_token, ... }`.

#### Errores
- `400 InvalidToken` / `TokenAlreadyUsed` / `TokenRevoked` / `TokenExpired`
- `409 Conflict` — email ya registrado

---

## Audit actions registradas

| Endpoint | Action |
|---|---|
| `PATCH /users/:id` | `admin.user.updated` |
| `DELETE /users/:id` | `admin.user.deleted` |
| `POST /users/:id/restore` | `admin.user.restored` |
| `POST /applications` | `admin.application.created` |
| `PATCH /applications/:id` | `admin.application.updated` |
| `DELETE /applications/:id` | `admin.application.deleted` |
| `POST /applications/:id/rotate-secret` | `admin.application.secret_rotated` |
| `POST /invitations` | `admin.invitation.created` |
| `DELETE /invitations/:id` | `admin.invitation.revoked` |
| `POST /auth/accept-invitation` | `admin.invitation.accepted` |
| `DELETE /sessions/:id` | `admin.session.revoked` |
| `DELETE /users/:userId/sessions` | `admin.sessions.revoked_all` |

## Pendiente próximas iteraciones

- [ ] API keys s2s (paso 3F)
- [ ] OAuth Google/Facebook (paso 3H)
- [ ] Cookie httpOnly para refresh (paso 3I)
- [ ] 2FA TOTP (paso 3E diferido)
