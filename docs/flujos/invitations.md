# Flujo — Invitaciones admin

Cómo se invita y onboarda nuevo staff/admin al sistema.

## ¿Por qué invitaciones y no registro abierto?

Los roles `staff`, `admin`, `super_admin` NO se autoasignan vía registro público (`/auth/register` crea solo `client`). Para añadir un nuevo administrador:

1. Un super_admin existente lo invita por email.
2. El invitado recibe link, llena sus datos y crea su cuenta.

Esto evita escalación de privilegios y mantiene auditoría completa de quién invitó a quién.

## Quién puede invitar qué

| Actor | Puede invitar a |
|---|---|
| `admin` | `staff` |
| `super_admin` | `staff`, `admin`, `super_admin` |

Validación enforced en `invitation.service.js` y por permisos del middleware.

## Flujo completo

```
super_admin             SSO              account.gemmatex.com.bo       Mail
    │                    │                          │                    │
    │ POST /admin/invitations                       │                    │
    │ { email, role: 'admin' }                      │                    │
    │ ────────────────►  │                          │                    │
    │                    │ valida rol               │                    │
    │                    │ verifica email no existe │                    │
    │                    │ invalida invites previos │                    │
    │                    │ genera token + sha256    │                    │
    │                    │ INSERT admin_invitations │                    │
    │                    │ sendInvitationEmail      │                    │
    │                    │ ────────────────────────────────────────────► │
    │ 201 invitation     │                          │                    │
    │ ◄──────────────── │                          │                    │
    │                                                                     │
    │                                              email arrives          │
    │                                                                     │
    │ (invitado click link)                          │                    │
    │                                                │                    │
    │ GET https://account.gemmatex.com.bo/accept-invitation?token=ABC    │
    │                                                │                    │
    │ frontend muestra form:                         │                    │
    │   password, first_name, last_name,             │                    │
    │   job_title, department, phone                 │                    │
    │                                                │                    │
    │ submit                                         │                    │
    │ POST /api/v1/auth/accept-invitation            │                    │
    │ ─────────────────────────────────────────►    │                    │
    │                    │                          │                    │
    │                    │ valida token             │                    │
    │                    │ TX:                      │                    │
    │                    │   INSERT user            │                    │
    │                    │   INSERT admin_profile   │                    │
    │                    │   INSERT user_roles      │                    │
    │                    │   UPDATE invitation      │                    │
    │                    │     accepted_at, accepted_user_id              │
    │                    │ COMMIT                   │                    │
    │                    │                          │                    │
    │                    │ issueTokenPair (login auto)                    │
    │                    │                          │                    │
    │ 201 user + tokens  │                          │                    │
    │ ◄──────────────── │                          │                    │
    │                                                                     │
    │ frontend redirige a /dashboard                                     │
```

## Estado de invitación

| `accepted_at` | `revoked_at` | `expires_at` | Estado |
|---|---|---|---|
| NULL | NULL | futuro | **pending** |
| NOT NULL | NULL | — | **accepted** |
| NULL | NOT NULL | — | **revoked** |
| NULL | NULL | pasado | **expired** |

Endpoint `GET /api/v1/admin/invitations?status=pending` filtra por el estado calculado.

## Token

- 32 bytes random base64url.
- Almacenado como `sha256(token)` en `admin_invitations.token_hash`.
- TTL configurable: `ADMIN_INVITE_TTL_DAYS` (default 7 días).
- Plano se envía SOLO al email del invitado.
- URL del email: `${EMAIL_INVITATION_URL_TEMPLATE}` con `{token}` reemplazado.

## Email branded

Plantilla: `src/services/email/templates/invitation.html`. Estilo Gemmatex (logo + azul + footer). Placeholders:

| Placeholder | Valor |
|---|---|
| `{{inviterName}}` | Nombre del super_admin/admin que invitó |
| `{{roleName}}` | `staff` / `admin` / `super_admin` |
| `{{invitationUrl}}` | Link al frontend |
| `{{ttlDays}}` | Días hasta expirar (default 7) |

## Datos requeridos al aceptar

| Campo | Obligatorio |
|---|---|
| `token` | ✓ |
| `password` | ✓ (política: 8 chars, mayús + minús + num) |
| `first_name` | ✓ |
| `last_name` | ✓ |
| `job_title` | opcional |
| `department` | opcional |
| `phone` | opcional |

Tras aceptar, el user:
- `status = 'active'`
- `email_verified_at = now()` (aceptar la invitación implica que controla el email)
- Tiene rol asignado (el del invitation)
- Tiene `admin_profile` (no `client_profile`)

## Auto-login post-acceptance

`POST /auth/accept-invitation` devuelve par de tokens (access + refresh) como un login normal. El frontend puede ir directo al dashboard sin pedir credenciales otra vez. UX limpia.

## Cancelar / revocar

Una invitación pendiente puede revocarse desde:

```bash
DELETE /api/v1/admin/invitations/:id
```

Tras revocar, el token deja de funcionar — si el invitado intenta usar el link → 400 TokenRevoked.

## Re-invitar mismo email

Si super_admin invita 2x al mismo email:
1. La invitación previa se marca `revoked_at = now()`.
2. Se crea una nueva con token nuevo.
3. El email anterior queda inservible.

Esto previene "doble cuenta" si el primer email se perdió.

## Audit logs generados

| Action | Cuándo |
|---|---|
| `admin.invitation.created` | super_admin envía invite |
| `admin.invitation.revoked` | admin cancela pending |
| `admin.invitation.accepted` | invitado completa form |

Cada uno con `actor_id`, `actor_type='admin'`, `entity='admin_invitations'`, `metadata` con email/role.

## Configuración

`.env`:
```
ADMIN_INVITE_TTL_DAYS=7
EMAIL_INVITATION_URL_TEMPLATE=https://account.gemmatex.com.bo/accept-invitation?token={token}
```

## Casos especiales

### Email del invitado ya registrado

Si super_admin invita un email que ya tiene cuenta cliente:
- POST /admin/invitations → 409 Conflict

No promovemos clientes a admin desde aquí. Para eso, super_admin debe usar `PATCH /api/v1/admin/users/:id { roles: ['admin'] }` directamente (paso 3G básico).

### Email del invitado tiene cuenta soft-deleted

Mismo flujo: 409 Conflict. Hay que restaurar primero (`POST /users/:id/restore`) o cambiar el email.

### Token usado dos veces

Segunda llamada → 400 TokenAlreadyUsed.

### Token expirado

400 TokenExpired. Super_admin debe crear nuevo invite.

## Ver también

- [docs/api/admin.md](../api/admin.md) — endpoints exactos
- [docs/emails/](../emails/README.md) — plantilla `invitation.html`
- [docs/base-de-datos/schema.md](../base-de-datos/schema.md) — tabla `admin_invitations`
