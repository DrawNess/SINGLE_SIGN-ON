# Flujo — Login y Refresh

## Login

```
Cliente              SSO             Postgres
   │                  │                  │
   │ POST /login      │                  │
   │ ───────────────► │                  │
   │ X-Client-Id      │                  │
   │ email+password   │                  │
   │                  │ Joi validate     │
   │                  │ ────────────     │
   │                  │                  │
   │                  │ findOne(email)   │
   │                  │ ──────────────►  │
   │                  │ ◄──────────────  │
   │                  │                  │
   │                  │ ¿status?         │
   │                  │ ¿locked_until?   │
   │                  │                  │
   │                  │ Argon2.verify    │
   │                  │ password         │
   │                  │ ─── (CPU bound)  │
   │                  │                  │
   │ Si pass FAIL:    │                  │
   │                  │ failed++         │
   │                  │ si >= 5:         │
   │                  │   lock 15min     │
   │                  │ UPDATE user      │
   │                  │ ──────────────►  │
   │                  │ audit log fail   │
   │ ◄─ 401 ────────  │                  │
   │                  │                  │
   │ Si pass OK:      │                  │
   │                  │ reset failed     │
   │                  │ last_login_at    │
   │                  │ UPDATE user      │
   │                  │ ──────────────►  │
   │                  │                  │
   │                  │ getRoles(user)   │
   │                  │ ──────────────►  │
   │                  │                  │
   │                  │ generate refresh │
   │                  │ random + sha256  │
   │                  │ family_id new    │
   │                  │ INSERT refresh   │
   │                  │ ──────────────►  │
   │                  │                  │
   │                  │ sign JWT RS256   │
   │                  │ (private.pem)    │
   │                  │                  │
   │                  │ audit success    │
   │ ◄─ 200 tokens ── │                  │
```

## Anti-enumeración

Si el email NO existe en DB, igualmente:
- No se cuenta como intento fallido (no hay usuario).
- Devuelve el **mismo error genérico**: `401 InvalidCredentials: Email o password incorrectos`.
- Auditoría registra `metadata.reason='user_not_found'`.

Si el email existe pero password incorrecta:
- Incrementa `failed_login_attempts`.
- Mismo error genérico.

Resultado: atacante no puede saber si un email está registrado.

## Lockout

```
intento 1 falla  →  failed_login_attempts = 1
intento 2 falla  →  failed_login_attempts = 2
...
intento 5 falla  →  locked_until = NOW() + 15 min
                    failed_login_attempts = 0  (reset al bloquear)
```

Mientras `locked_until > now()`, login devuelve `423 AccountLocked` (sí revela el lockout — el usuario legítimo necesita saber que debe esperar).

## Refresh

```
Cliente              SSO             Postgres
   │                  │                  │
   │ POST /refresh    │                  │
   │ ───────────────► │                  │
   │ refresh_token    │                  │
   │                  │ sha256(token)    │
   │                  │                  │
   │                  │ findOne(hash)    │
   │                  │ ──────────────►  │
   │                  │                  │
   │ Si NO existe:    │                  │
   │ ◄ 401 ─────────  │                  │
   │                  │                  │
   │ Si revoked_at:   │  🚨 ROBO         │
   │                  │ UPDATE family    │
   │                  │ SET revoked_at   │
   │                  │ ──────────────►  │
   │                  │ audit theft      │
   │ ◄ 401 theft ───  │                  │
   │                  │                  │
   │ Si expired:      │                  │
   │ ◄ 401 ─────────  │                  │
   │                  │                  │
   │ Si OK: ROTACIÓN  │                  │
   │                  │ TRANSACTION ▼    │
   │                  │ INSERT new token │
   │                  │ ──────────────►  │
   │                  │ UPDATE old       │
   │                  │ revoked=now      │
   │                  │ reason=rotation  │
   │                  │ replaced_by=new  │
   │                  │ ──────────────►  │
   │                  │ COMMIT           │
   │                  │                  │
   │                  │ sign new JWT     │
   │                  │ audit refreshed  │
   │ ◄ 200 tokens ──  │                  │
```

### Estado en DB tras refresh

Antes:
```
refresh_tokens
| id  | family_id | token_hash | revoked_at | replaced_by |
|-----|-----------|------------|------------|-------------|
| t1  | f1        | hash1      | NULL       | NULL        |
```

Después:
```
refresh_tokens
| id  | family_id | token_hash | revoked_at | revoked_reason | replaced_by |
|-----|-----------|------------|------------|----------------|-------------|
| t1  | f1        | hash1      | <now>      | rotation       | t2          |
| t2  | f1        | hash2      | NULL       | NULL           | NULL        |
```

Mismo `family_id`. Token nuevo apunta hacia atrás (lineage).

## Por qué rotar siempre

Sin rotación:
- Atacante roba refresh → puede pedir access tokens indefinidamente.
- Difícil detectar.

Con rotación:
- Cada uso del refresh emite uno nuevo + invalida el viejo.
- Si víctima usa su refresh viejo después → el SSO sabe que alguien más ya rotó → robo detectado.

## Frecuencia esperada

- Access token TTL: 15 min.
- Cliente refresca cada ~10-12 min (antes de que expire).
- Refresh rotation: cada 10-12 min.
- En 7 días: ~700-1000 refreshes por sesión activa.

Volume de DB: aceptable. Tabla `refresh_tokens` puede limpiarse con job nocturno que borra los `revoked_at < NOW() - INTERVAL '30 days'`.

## Caso especial: refresh tras password change

Cuando el usuario cambia password (futuro endpoint), se revocan TODOS sus refresh tokens con `revoked_reason='password_changed'`. Esto fuerza re-login en todos los dispositivos. Seguridad por defecto.

## Logout

Caso normal:
```bash
POST /auth/logout
Authorization: Bearer <access_token>
{ "refresh_token": "..." }
```

Solo revoca el refresh especificado (un dispositivo).

Logout en todos los dispositivos:
```bash
POST /auth/logout
Authorization: Bearer <access_token>
{ "all_devices": true }
```

Revoca **todos** los refresh activos del user. Útil tras detectar acceso sospechoso.

⚠ El access token (JWT) NO se invalida — sigue funcionando hasta que expira (15 min). Aceptamos esto: 15min es ventana corta. Para invalidación inmediata habría que mantener una blacklist en Redis/DB, complicando el modelo stateless.
