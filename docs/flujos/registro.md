# Flujo — Registro

Cómo se registra un cliente nuevo.

## Secuencia

```
Cliente              SSO            Postgres
   │                  │                 │
   │  POST /register  │                 │
   │ ───────────────► │                 │
   │  X-Client-Id     │                 │
   │  + body JSON     │                 │
   │                  │  Joi validate   │
   │                  │ ──────────────  │
   │                  │                 │
   │                  │ Resolve app     │
   │                  │ por client_id   │
   │                  │ ─────────────►  │
   │                  │                 │
   │                  │ Check email     │
   │                  │ existe ?        │
   │                  │ ─────────────►  │
   │                  │                 │
   │                  │ Check phone     │
   │                  │ existe ?        │
   │                  │ ─────────────►  │
   │                  │                 │
   │                  │ Check document  │
   │                  │ existe ?        │
   │                  │ ─────────────►  │
   │                  │                 │
   │                  │ Argon2 hash     │
   │                  │ password        │
   │                  │                 │
   │                  │ TRANSACTION ▼   │
   │                  │   INSERT user   │
   │                  │ ─────────────►  │
   │                  │   INSERT profile│
   │                  │ ─────────────►  │
   │                  │   INSERT role   │
   │                  │ ─────────────►  │
   │                  │ COMMIT          │
   │                  │                 │
   │                  │ audit_log       │
   │                  │ ─────────────►  │
   │                  │                 │
   │  201 user        │                 │
   │ ◄─────────────── │                 │
```

## Estado tras registro

| Campo `users` | Valor |
|---|---|
| `status` | `active` ⚠ |
| `email_verified_at` | `null` |
| `password_hash` | Argon2id hash |
| `password_changed_at` | `now()` |

⚠ **Nota importante**: el MVP actual marca como `active` directo. En la próxima iteración (paso 3B) se cambiará a `pending` y se requerirá:
- Verificación de email (link en correo)
- Verificación de SMS

Solo entonces `status → active` y se permite login.

## Roles asignados

- `client` automáticamente (rol obligatorio para registro público).

## Tablas afectadas

| Tabla | INSERT |
|---|---|
| `users` | 1 fila |
| `client_profiles` | 1 fila |
| `user_roles` | 1 fila (user ↔ role 'client') |
| `audit_logs` | 1 fila (action='auth.register') |

Todo en transacción atómica — si algo falla, ROLLBACK total.

## Validaciones aplicadas

### Cliente (Joi en `src/schemas/auth.schemas.js`)
- `email` formato email válido.
- `password` ≥ 8 chars, 1 mayús + 1 minús + 1 num.
- `phone` regex `+591########`.
- `document_number` obligatorio si `document_type` presente.
- `razon_social` obligatorio si `document_type='NIT'`.
- `birth_date` en el pasado.
- `departamento` en lista cerrada.

### Servidor (`auth.service.js`)
- `email` no duplicado.
- `phone` no duplicado (UNIQUE constraint también).
- `document_number` no duplicado.
- `Application` activa.
- `Role` `client` existe.

### Dirección opcional (desde 2026-05)

Los campos de dirección (`departamento`, `provincia`, `ciudad`, `calle_avenida`, `numero`) son **opcionales** en `/auth/register`. El cliente puede completarlos después desde `PATCH /auth/me`. Esto agiliza el onboarding inicial.

Solo obligatorios: `email`, `password`, `first_name`, `last_name`, `phone`.

### Base de datos
- CHECK `phone ~ '^\+591[0-9]{8}$'`.
- CHECK `NIT ⇒ razon_social NOT NULL`.
- UNIQUE en `email`, `phone`, `document_number`.

## Casos de error

| Caso | Status | Body |
|---|---|---|
| Email duplicado | 409 | `{ error: 'EmailInUse' }` |
| Phone duplicado | 409 | `{ error: 'PhoneInUse' }` |
| Documento duplicado | 409 | `{ error: 'DocumentInUse' }` |
| Email mal formato | 400 | `{ error: 'ValidationError', details: [...] }` |
| Phone mal formato | 400 | `{ error: 'ValidationError', details: [{ path: 'phone', message: 'Teléfono debe tener formato +591########' }] }` |
| `X-Client-Id` faltante | 400 | `{ error: 'BadRequest', message: 'Header X-Client-Id requerido' }` |
| App inexistente | 400 | `{ error: 'BadRequest', message: 'Aplicación no encontrada o inactiva' }` |

## ¿Por qué NO devolver tokens en register?

Por dos razones:

1. **Verificación pendiente**: en flujo final el usuario debe verificar email/SMS antes de loguear. Devolver tokens en register saltea ese paso.

2. **Auditoría limpia**: el endpoint de login registra `auth.login.success` con metadata. Si register también emitiera tokens, tendríamos dos eventos similares pero distintos. Cleaner separar.

El cliente debe llamar `/api/v1/auth/login` tras `/api/v1/auth/register`.

## Ejemplo curl

```bash
curl -X POST http://localhost:2106/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Client-Id: app_ecommerce_dev" \
  -d '{
    "email": "maria.lopez@test.bo",
    "password": "Segura123",
    "first_name": "Maria",
    "last_name": "Lopez",
    "phone": "+59172345678",
    "departamento": "Santa Cruz",
    "provincia": "Andrés Ibáñez",
    "ciudad": "Santa Cruz de la Sierra",
    "calle_avenida": "Av. Cristo Redentor",
    "numero": "500"
  }'
```

## Audit log generado

```json
{
  "action": "auth.register",
  "user_id": "<nuevo user>",
  "actor_id": "<nuevo user>",
  "actor_type": "user",
  "application_id": "<app>",
  "ip": "::1",
  "user_agent": "curl/8.x",
  "metadata": { "email": "maria.lopez@test.bo" },
  "created_at": "..."
}
```
