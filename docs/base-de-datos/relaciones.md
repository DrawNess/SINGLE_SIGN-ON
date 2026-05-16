# Relaciones de tablas

Diagrama lógico y reglas de cascada.

## Diagrama

```
                          ┌──────────┐
                          │  roles   │
                          └────┬─────┘
                               │ M:N
                          ┌────┴──────┐
                          │user_roles │
                          └────┬──────┘
                               │
   ┌─────────────────┐         │         ┌──────────────────────┐
   │ client_profiles │◄────1:1─┤         │  audit_logs          │
   └─────────────────┘         │         │  (user_id, actor_id) │
                               ▼         └──────────▲───────────┘
                          ┌─────────┐               │
   ┌─────────────────┐    │         │               │
   │ admin_profiles  │◄1:1┤  users  ├──────hasMany──┤
   └─────────────────┘    │         │               │
                          └────┬────┘               │
                               │                    │
       ┌───────────────────────┼────────────────────┘
       │                       │
       │ hasMany               │ hasMany
       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐
│ auth_providers   │   │ refresh_tokens   │◄─── application_id ──┐
└──────────────────┘   └──────────────────┘                      │
                                                                  │
┌──────────────────┐   ┌──────────────────┐                      │
│email_verifications│  │phone_verifications│                     │
└──────────────────┘   └──────────────────┘                      │
                                                                  │
┌──────────────────┐   ┌──────────────────┐                      │
│ password_resets  │   │ password_history │                      │
└──────────────────┘   └──────────────────┘                      │
                                                                  │
                          ┌──────────────────┐                   │
                          │ admin_invitations│                   │
                          └──────────────────┘                   │
                                                                  │
                          ┌──────────────────┐                   │
                          │   applications   │◄──────────────────┤
                          └────────┬─────────┘                   │
                                   │ 1:N                          │
                                   ▼                              │
                          ┌──────────────────┐                   │
                          │     api_keys     │                   │
                          └──────────────────┘                   │
                                                                  │
                          ┌──────────────────┐                   │
                          │   audit_logs     ├───────────────────┘
                          │ (application_id) │
                          └──────────────────┘
```

## Reglas de cascada (ON DELETE)

| Tabla padre | Tabla hija | Acción |
|---|---|---|
| `users` | `client_profiles.user_id` | **CASCADE** |
| `users` | `admin_profiles.user_id` | **CASCADE** |
| `users` | `user_roles.user_id` | **CASCADE** |
| `users` | `auth_providers.user_id` | **CASCADE** |
| `users` | `refresh_tokens.user_id` | **CASCADE** |
| `users` | `email_verifications.user_id` | **CASCADE** |
| `users` | `phone_verifications.user_id` | **CASCADE** |
| `users` | `password_resets.user_id` | **CASCADE** |
| `users` | `password_history.user_id` | **CASCADE** |
| `users` | `user_roles.assigned_by` | **SET NULL** |
| `users` | `applications.created_by` | **SET NULL** |
| `users` | `api_keys.created_by` | **SET NULL** |
| `users` | `audit_logs.user_id` | **SET NULL** |
| `users` | `audit_logs.actor_id` | **SET NULL** |
| `users` | `admin_invitations.invited_by` | **RESTRICT** |
| `users` | `admin_invitations.accepted_user_id` | **SET NULL** |
| `roles` | `user_roles.role_id` | **RESTRICT** |
| `roles` | `admin_invitations.invited_role_id` | **RESTRICT** |
| `applications` | `api_keys.application_id` | **CASCADE** |
| `applications` | `refresh_tokens.application_id` | **RESTRICT** |
| `applications` | `audit_logs.application_id` | **SET NULL** |
| `api_keys` | `audit_logs.api_key_id` | **SET NULL** |
| `refresh_tokens` | `refresh_tokens.replaced_by` (self) | **SET NULL** |

## Por qué estas reglas

### CASCADE en datos personales

Si borras un user (hard delete, no soft delete), borras su perfil, tokens activos, verificaciones pendientes. **Pero**: en producción casi siempre se usa **soft delete** (`deleted_at`), no hard delete. CASCADE solo aplica si haces hard delete.

### SET NULL en auditoría

`audit_logs.user_id`, `actor_id`, `api_key_id`, `application_id` → SET NULL.

**Por qué**: si borras un user, su historial NO debe desaparecer. La auditoría debe sobrevivir. SET NULL deja el log intacto, solo "olvida" a quién apuntaba.

### RESTRICT en roles

Borrar un rol que tiene users asignados → bloqueado. Esto previene errores. Para eliminar un rol primero hay que reasignar sus users.

### RESTRICT en applications para refresh_tokens

No puedes borrar una app si tiene refresh tokens activos. Primero revocar todos los tokens, luego borrar la app (soft delete preferido de hecho).

### Self-referencia en refresh_tokens

`replaced_by` apunta al token sucesor en una rotación. Cuando ese sucesor se borra, el campo se pone NULL en el predecesor.

## Soft delete

Solo `users` y `applications` tienen `deleted_at`.

```js
// Sequelize aplica paranoid en queries por defecto
const users = await User.findAll(); // excluye deleted

// Para incluir:
const all = await User.findAll({ paranoid: false });
```

## Triggers `updated_at`

7 tablas tienen `updated_at` con trigger automático:
- `users`, `roles`, `applications`
- `client_profiles`, `admin_profiles`
- `auth_providers`, `admin_invitations`

```sql
CREATE TRIGGER tg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Esto garantiza que `updated_at` se actualice incluso ante un `UPDATE` por SQL directo (no solo desde Sequelize).
