# API: `GET /admin/stats`

Reporte agregado del SSO GEMMATEX. Diseñado para dashboards administrativos y exports.

---

## 1. Endpoint

```
GET https://sso.gemmatex.com/api/v1/admin/stats
```

## 2. Autenticación

**Requerida.** Header:

```
Authorization: Bearer <access_token>
```

El `access_token` se obtiene haciendo login del admin via `POST /api/v1/auth/login` con `X-Client-Id: app_account_portal_prod`.

## 3. Autorización

Solo accesible con rol `admin` o `super_admin`. Verificación a 2 niveles:

1. `requireAuth()` — valida JWT (firma RS256, exp, aud, iss)
2. `requireRole('admin', 'super_admin')` — extrae `roles` del JWT y exige uno de los dos

Si llega un JWT de un cliente normal → `403 Forbidden`. Si no llega JWT → `401 Unauthorized`.

## 4. Query parameters

Todos opcionales:

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `from`     | ISO date | hace 30 días     | Inicio del rango (inclusive) |
| `to`       | ISO date | ahora            | Fin del rango (**exclusivo**, semiabierto) |
| `timezone` | IANA tz  | `America/La_Paz` | Zona horaria para agrupaciones por día |
| `compare`  | enum     | `previous`       | `previous` incluye comparación con periodo anterior; `none` la omite |

**Reglas:**
- Formato ISO 8601: `2026-06-01` o `2026-06-01T00:00:00Z`
- `to` debe ser mayor que `from` (Joi lo valida → `400` si falla)
- Rango **semiabierto**: eventos con `created_at = to` NO se incluyen. Para "incluir junio 30 completo", pasá `to=2026-07-01`
- Las métricas con sufijo `_in_range` usan estos parámetros; las globales (`total`, `_now`) los ignoran
- Time series agrupan por día en la `timezone` especificada (resuelve eventos cerca de medianoche)

**Ejemplos:**

```
GET /admin/stats                                          # default 30 días
GET /admin/stats?from=2026-06-01&to=2026-06-30           # junio completo
GET /admin/stats?from=2026-01-01                          # desde enero, hasta ahora
```

## 5. Cómo se calcula (por sección)

| Sección | Tabla(s) | Estrategia |
|---------|----------|-----------|
| `users` (counts globales) | `users` | `COUNT(*)` con filtros de status, paranoid:false para deleted |
| `users.registered_in_range` | `users` | `WHERE created_at BETWEEN from AND to` |
| `profile_completeness` | `client_profiles` | `COUNT(*) FILTER (WHERE ...)` para cada campo no-null |
| `auth.logins_*` | `audit_logs` | `WHERE action='auth.login.success'` (o `.failed`) y rango |
| `auth.failure_reasons` | `audit_logs` | `GROUP BY metadata->>'reason'` |
| `auth.token_theft_detected` | `audit_logs` | `WHERE action='auth.token.theft_detected'` |
| `sessions.active_refresh_tokens` | `refresh_tokens` | `WHERE revoked_at IS NULL AND expires_at > NOW()` |
| `top_failure_ips` | `audit_logs` | `GROUP BY ip ORDER BY count DESC LIMIT 10` |
| `time_series.registrations_per_day` | `users` | `GROUP BY DATE(created_at)` |
| `time_series.logins_per_day` | `audit_logs` | `GROUP BY DATE(created_at)` con FILTER por action |
| `geography.by_city` | `client_profiles` | `GROUP BY ciudad`, top 15 |
| `geography.by_departamento` | `client_profiles` | `GROUP BY departamento` (ENUM) |
| `demographics.by_age_group` | `client_profiles` | `CASE WHEN AGE(birth_date) ...` agrupado en rangos |
| `onboarding` | `users` | `percentile_cont(0.5/0.9) WITHIN GROUP ORDER BY (last_login_at - created_at)` |

**Optimización:** las queries globales se ejecutan en paralelo con `Promise.all`. Total ~10-15 queries pero llegan en una sola response. Latencia esperada en prod: 100-300ms para 150 usuarios. Escala bien hasta ~50K usuarios sin índices extra.

## 6. Response — Schema y ejemplo

**Content-Type:** `application/json`

```jsonc
{
  // Rango temporal aplicado a métricas "_in_range"
  "range": {
    "from": "2026-05-11T21:16:33.667Z",
    "to":   "2026-06-10T21:16:33.667Z"
  },

  // Timestamp del cálculo (útil para cache invalidation)
  "generated_at": "2026-06-10T21:16:33.756Z",

  // ─────────────────────────────────────────────────────
  // USERS (globales + uno en rango)
  // ─────────────────────────────────────────────────────
  "users": {
    "total":   155,        // TODOS los users (cualquier rol)
    "clients": 156,        // # de client_profiles
    "admins":  1,          // # de admin_profiles
    "by_status": {
      "active":    150,
      "pending":   5,      // registrados sin verificar email
      "suspended": 0,      // bloqueados por admin
      "deleted":   2       // soft-deleted (paranoid)
    },
    "verified":         150,    // email_verified_at != null
    "verified_pct":     96.8,   // 150/155 * 100, 1 decimal
    "with_login_ever":  13,     // last_login_at != null
    "with_login_pct":   8.4,
    "blocked_now":      0,      // locked_until > now (brute force lockout)
    "registered_in_range": 155  // ESTE SI usa from/to
  },

  // ─────────────────────────────────────────────────────
  // PROFILE COMPLETENESS (solo client_profiles)
  // ─────────────────────────────────────────────────────
  "profile_completeness": {
    "total_clients":       156,
    "with_phone":          156,   // phone != null Y no es placeholder +591000xxx
    "with_phone_pct":      100,
    "with_document":       5,     // document_type Y document_number presentes
    "with_document_pct":   3.2,
    "with_address":        4,     // ciudad Y calle_avenida presentes
    "with_address_pct":    2.6,
    "with_birth_date":     4,
    "fully_completed":     3,     // todos los campos: doc + address + birth
    "fully_completed_pct": 1.9
  },

  // ─────────────────────────────────────────────────────
  // AUTH (en rango)
  // ─────────────────────────────────────────────────────
  "auth": {
    "logins_success_in_range": 76,
    "logins_failed_in_range":  15,
    "failure_rate_pct":        16.5,    // fails / (success+fails) * 100
    "failure_reasons": {                 // breakdown del metadata.reason
      "bad_password":   10,
      "user_not_found": 5
      // Otros posibles: "email_not_verified", "account_locked", "account_deleted"
    },
    "password_resets_requested": 5,
    "password_resets_completed": 5,
    "reset_completion_pct":      100,    // completed / requested * 100
    "token_theft_detected":      6       // refresh token rotado mas viejo recibido → familia revocada
  },

  // ─────────────────────────────────────────────────────
  // SESSIONS (global, snapshot ahora)
  // ─────────────────────────────────────────────────────
  "sessions": {
    "active_refresh_tokens": 27    // sesiones vivas (revoked_at NULL, no expirados)
  },

  // ─────────────────────────────────────────────────────
  // TOP 10 IPs CON MAS LOGINS FALLIDOS (en rango)
  // ─────────────────────────────────────────────────────
  "top_failure_ips": [
    { "ip": "190.129.164.123/32", "attempts": 7 },
    { "ip": "181.115.143.241/32", "attempts": 2 }
    // ...
  ],
  // Nota: ip es tipo CIDR (Postgres `inet`). El `/32` indica IPv4 host único.

  // ─────────────────────────────────────────────────────
  // TIME SERIES (en rango, 1 fila por dia con actividad)
  // ─────────────────────────────────────────────────────
  "time_series": {
    "registrations_per_day": [
      { "date": "2026-06-09", "count": 150 },
      { "date": "2026-06-10", "count": 7 }
    ],
    "logins_per_day": [
      { "date": "2026-06-09", "success": 36, "failed": 9 },
      { "date": "2026-06-10", "success": 40, "failed": 6 }
    ]
  },
  // ⚠ Días SIN actividad NO aparecen. Si necesitás zero-filled series,
  //   el frontend debe rellenar.

  // ─────────────────────────────────────────────────────
  // GEOGRAFIA (global, no en rango)
  // ─────────────────────────────────────────────────────
  "geography": {
    "by_city": [
      { "city": "(sin dato)", "count": 152 },     // NULL agrupado
      { "city": "La Paz",     "count": 1 }
      // ...top 15
    ],
    "by_departamento": [
      { "departamento": "(sin dato)", "count": 153 },
      { "departamento": "La Paz",     "count": 1 }
      // departamento es ENUM: La Paz, Cochabamba, Santa Cruz, Oruro,
      // Potosí, Chuquisaca, Tarija, Beni, Pando
    ]
  },

  // ─────────────────────────────────────────────────────
  // DEMOGRAFIA (global)
  // ─────────────────────────────────────────────────────
  "demographics": {
    "by_age_group": [
      { "age_group": "(sin dato)", "count": 152 },
      { "age_group": "25-34",      "count": 3 },
      { "age_group": "45-54",      "count": 1 }
      // Buckets: <18, 18-24, 25-34, 35-44, 45-54, 55+, (sin dato)
    ]
  },

  // ─────────────────────────────────────────────────────
  // ONBOARDING (global, solo usuarios que YA iniciaron sesión)
  // ─────────────────────────────────────────────────────
  "onboarding": {
    "total_logueados": 14,
    "p50_horas":       0.06,   // mediana — 50% se loguearon en < 0.06h
    "p90_horas":       22.44   // 90% se loguearon en < 22h
  },
  // null si no hay nadie con login todavia

  // ─────────────────────────────────────────────────────
  // META
  // ─────────────────────────────────────────────────────
  "meta": {
    "roles_count":        4,    // client, staff, admin, super_admin
    "applications_count": 3     // account-portal-prod, ecommerce-prod, api-v6-prod
  }
}
```

## 7. Códigos de respuesta

| Status | Cuándo |
|--------|--------|
| `200`  | OK. Body JSON con stats |
| `400`  | `from`/`to` mal formato o `to <= from` |
| `401`  | Sin Authorization o JWT inválido/expirado |
| `403`  | JWT válido pero rol insuficiente (no es admin/super_admin) |
| `500`  | Error interno (revisar logs SSO) |

## 8. Headers de respuesta relevantes

```
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Credentials: true
Vary: Origin
```

Otros headers de seguridad inyectados por Helmet (CSP, X-Frame-Options, etc).

## 9. CORS

El frontend de admin (`account.gemmatex.com.bo`) está en `CORS_ORIGINS` del SSO. Si llamás desde otro origen → preflight `OPTIONS` falla → request bloqueado por browser.

## 10. Cache & rate limit

- **Sin cache server-side actualmente.** Cada request recalcula. Para 150 users es trivial. Si crece a >10K considerar caching 1-5 min.
- **Sin rate limit dedicado** en este endpoint. Solo el rate limit global del SSO. No spam-ear cada segundo.

## 11. Notas para el frontend

1. **Polling vs manual:** mejor `refresh()` manual con botón. Auto-polling cada 30s es overkill y carga DB.
2. **Diff de rangos:** para "últimos 7 vs 30 días", hacé 2 llamadas con distintos `from`. NO hay un endpoint comparativo dedicado.
3. **Time series con días vacíos:** rellenar zeros en frontend si tu chart lo requiere:
   ```ts
   function fillMissingDays(series, from, to) {
     const out = [];
     for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
       const key = d.toISOString().slice(0, 10);
       const found = series.find(r => r.date === key);
       out.push({ date: key, count: found?.count ?? 0 });
     }
     return out;
   }
   ```
4. **Export a Excel:** los `_pct` ya vienen redondeados a 1 decimal. No re-formatear.
5. **Refresh tokens activos != usuarios logueados ahora.** Una persona puede tener varias sesiones (móvil + desktop). Para "users online actualmente" no hay endpoint — se inferiría con un query custom.

## 12. Eventos que alimentan el reporte (referencia)

Acciones registradas en `audit_logs` que las queries leen:

- `auth.register` — nuevo signup
- `auth.login.success` — login OK
- `auth.login.failed` — login fallido (metadata.reason: bad_password, user_not_found, ...)
- `auth.logout` — logout manual
- `auth.token.refreshed` — refresh exitoso
- `auth.token.theft_detected` — refresh token viejo reutilizado → familia revocada
- `auth.password.reset_requested` — forgot-password
- `auth.password.reset_completed` — reset-password exitoso
- `user.profile.updated` — PATCH /auth/me

Si agregás más acciones al SSO, el endpoint las verá automáticamente (las queries son agnósticas).
