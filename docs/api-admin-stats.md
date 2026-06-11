# API: `GET /admin/stats`

Reporte agregado del SSO GEMMATEX. Diseñado para dashboards administrativos y exports.

> Última actualización: 2026-06-11

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
- Rango **semiabierto**: eventos con `created_at == to` NO se incluyen. Para "incluir junio 30 completo", pasá `to=2026-07-01`
- Las métricas con sufijo `_in_range` usan estos parámetros; las globales (`total`, `_now`) los ignoran
- Time series agrupan por día en la `timezone` especificada (resuelve eventos cerca de medianoche)

**Ejemplos:**

```
GET /admin/stats                                                       # default 30 días
GET /admin/stats?from=2026-06-04T00:00:00Z&to=2026-06-11T00:00:00Z   # última semana
GET /admin/stats?from=2026-06-01&to=2026-07-01                        # junio completo
GET /admin/stats?compare=none                                          # sin comparación
GET /admin/stats?timezone=UTC                                          # agrupado en UTC
```

## 5. Cómo se calcula (por sección)

| Sección | Tabla(s) | Estrategia |
|---------|----------|-----------|
| `users.total` | `users` | `COUNT(*)` con paranoid:true (excluye soft-deleted) |
| `users.total_including_deleted` | `users` | `COUNT(*)` con paranoid:false |
| `users.by_status.deleted` | `users` | `WHERE status='deleted'` paranoid:false |
| `users.registered_in_range` | `users` | `WHERE created_at >= from AND created_at < to` |
| `users.registered_in_range_delta_pct` | `users` | `(curr - prev) / prev * 100` |
| `profile_completeness` | `client_profiles` | `COUNT(*) FILTER (WHERE ...)` por campo |
| `data_quality` | `client_profiles` | Filters específicos de calidad |
| `auth.logins_*` | `audit_logs` | `action='auth.login.{success|failed}'` y rango |
| `auth.unique_users_logged_in_in_range` | `audit_logs` | `COUNT(DISTINCT user_id)` |
| `auth.failure_reasons` | `audit_logs` | `GROUP BY metadata->>'reason'` |
| `auth.by_application` | `audit_logs JOIN applications` | `GROUP BY application_id` |
| `auth.token_theft_detected` | `audit_logs` | `action='auth.token.theft_detected'` |
| `sessions.active_refresh_tokens` | `refresh_tokens` | `WHERE revoked_at IS NULL AND expires_at > NOW()` |
| `top_failure_ips` | `audit_logs` | `GROUP BY ip ORDER BY count DESC LIMIT 10` |
| `time_series.*` | `audit_logs` / `users` | `GROUP BY (created_at AT TIME ZONE :tz)::date` |
| `geography.by_city` | `client_profiles` | `GROUP BY ciudad`, top 15 |
| `geography.by_departamento` | `client_profiles` | `GROUP BY departamento::text` (ENUM cast) |
| `demographics.by_age_group` | `client_profiles` | `CASE WHEN AGE(birth_date) ...` en buckets |
| `onboarding` | `audit_logs + users` | `WITH first_logins AS (MIN(created_at) WHERE action='auth.login.success' GROUP BY user_id) → percentile_cont(0.5/0.9) WITHIN GROUP ORDER BY (first_login - registered)` |

**Optimización:**

- TODAS las queries corren en una sola `Promise.all` (paralelo)
- Latencia esperada con índices: 50-150ms para <100K rows en audit_logs
- Sin índices y >100K rows: puede subir a 500ms+

**Índices que aceleran el endpoint** (migration `20260611000001-add-stats-indexes`):

```sql
CREATE INDEX idx_audit_logs_action_created_at ON audit_logs (action, created_at DESC);
CREATE INDEX idx_audit_logs_action_user_created ON audit_logs (action, user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX idx_users_created_at ON users (created_at);
CREATE INDEX idx_refresh_tokens_active ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;
```

## 6. Response — Schema completo

**Content-Type:** `application/json`

```jsonc
{
  // ──── METADATA del reporte ────
  "range": {
    "from": "2026-06-04T00:00:00.000Z",
    "to":   "2026-06-11T00:00:00.000Z",
    "timezone": "America/La_Paz",
    "semi_open": true,                       // [from, to)
    "previous": {                             // null si compare=none
      "from": "2026-05-28T00:00:00.000Z",
      "to":   "2026-06-04T00:00:00.000Z"
    }
  },
  "generated_at": "2026-06-11T15:30:00.000Z",

  // ──── USERS ────
  "users": {
    "total": 155,                             // utilizables (excluye deleted)
    "total_including_deleted": 157,           // auditoría
    "clients": 156,                           // # client_profiles
    "admins": 1,                              // # admin_profiles
    "by_status": {
      "active":    150,
      "pending":   5,
      "suspended": 0,
      "deleted":   2
    },
    "verified":          150,
    "verified_pct":      96.8,
    "with_login_ever":   13,
    "with_login_pct":    8.4,
    "blocked_now":       0,
    "registered_in_range":             7,
    "registered_in_range_delta_pct":   40.0   // % vs periodo anterior. null si compare=none
  },

  // ──── PROFILE COMPLETENESS ────
  "profile_completeness": {
    "total_clients":       156,
    "with_phone":          156,  "with_phone_pct":      100,
    "with_document":       5,    "with_document_pct":   3.2,
    "with_address":        4,    "with_address_pct":    2.6,
    "with_birth_date":     4,
    "fully_completed":     3,    "fully_completed_pct": 1.9
  },

  // ──── DATA QUALITY (campañas cleanup) ────
  "data_quality": {
    "placeholder_or_missing_phone": 141,
    "missing_document":             151,
    "incomplete_address":           152
  },

  // ──── AUTH (eventos en rango) ────
  "auth": {
    "logins_success_in_range":              76,
    "logins_success_delta_pct":             25.5,    // null si compare=none
    "logins_failed_in_range":               15,
    "logins_failed_delta_pct":              -10,
    "unique_users_logged_in_in_range":      11,
    "failure_rate_pct":                     16.5,
    "failure_reasons": {
      "bad_password":   10,
      "user_not_found": 5
      // Otros: "email_not_verified", "account_locked", "account_deleted"
    },
    "password_resets_requested":             5,
    "password_resets_requested_delta_pct":   150,
    "password_resets_completed":             5,
    "reset_completion_pct":                  100,    // ⚠ Ratio puro, no cohort
    "token_theft_detected":                  1,
    "by_application": [
      { "app_name": "ecommerce-prod",       "count": 60 },
      { "app_name": "account-portal-prod",  "count": 16 }
    ]
  },

  // ──── SESSIONS (snapshot ahora, no en rango) ────
  "sessions": {
    "active_refresh_tokens": 27
  },

  // ──── TOP 10 IPs CON LOGIN FALLIDO (en rango) ────
  "top_failure_ips": [
    { "ip": "190.129.164.123/32", "attempts": 7 },
    { "ip": "181.115.143.241/32", "attempts": 2 }
  ],
  // ip es CIDR (Postgres `inet`). /32 = IPv4 host único.

  // ──── TIME SERIES (en rango, timezone-aware) ────
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

  // ──── GEOGRAFÍA (global, no en rango) ────
  "geography": {
    "by_city": [
      { "city": "(sin dato)", "count": 152 },
      { "city": "La Paz",     "count": 1 }
    ],
    "by_departamento": [
      { "departamento": "(sin dato)", "count": 153 },
      { "departamento": "La Paz",     "count": 1 }
      // ENUM Bolivia: La Paz, Cochabamba, Santa Cruz, Oruro,
      // Potosí, Chuquisaca, Tarija, Beni, Pando
    ]
  },

  // ──── DEMOGRAFÍA (global) ────
  "demographics": {
    "by_age_group": [
      { "age_group": "(sin dato)", "count": 152 },
      { "age_group": "25-34",      "count": 3 },
      { "age_group": "45-54",      "count": 1 }
      // Buckets: <18, 18-24, 25-34, 35-44, 45-54, 55+, (sin dato)
    ]
  },

  // ──── ONBOARDING (global, basado en PRIMER login real) ────
  "onboarding": {
    "total_logueados": 13,
    "p50_horas":       0.06,    // mediana
    "p90_horas":       22.44
  },
  // null si no hay ningún login todavía

  // ──── META ────
  "meta": {
    "roles_count":        4,
    "applications_count": 3
  }
}
```

## 7. Códigos de respuesta

| Status | Cuándo |
|--------|--------|
| `200`  | OK. Body JSON con stats |
| `400`  | `from`/`to` mal formato o `to <= from` |
| `401`  | Sin Authorization o JWT inválido/expirado |
| `403`  | JWT válido pero rol insuficiente |
| `500`  | Error interno (revisar logs SSO) |

## 8. Headers de respuesta relevantes

```
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Credentials: true
Vary: Origin
```

Otros headers de seguridad inyectados por Helmet (CSP, X-Frame-Options, HSTS, etc).

## 9. CORS

El frontend de admin (`account.gemmatex.com.bo`) debe estar en `CORS_ORIGINS` del SSO. Si llamás desde otro origen → preflight `OPTIONS` falla → request bloqueado por browser.

Configuración actual en `.env` del SSO:
```
CORS_ORIGINS=https://account.gemmatex.com.bo,https://gemmatex.com.bo
```

## 10. Cache & rate limit

- **Sin cache server-side actualmente.** Cada request recalcula. Para <50K rows es trivial. Si crece a >500K considerar cache 1-5 min con Redis.
- **Sin rate limit dedicado** en este endpoint. Solo el rate limit global del SSO (10/min/IP en login). Para `/admin/stats` no se rate-limit explícito (esperá razonable: 1 request cada pocos segundos).

## 11. Convenciones importantes

### Rangos semiabiertos `[from, to)`

Eventos con `created_at == to` NO se incluyen. Razones:

- Evita ambigüedad con fines de día
- Facilita "periodos completos": junio = `from=2026-06-01&to=2026-07-01`
- Si pasás `to=2026-06-30` (sin hora) → JS lo interpreta como `2026-06-30T00:00:00Z` → eventos del día 30 NO entran. Para incluir todo el 30, pasá `to=2026-07-01`

### Comparación con periodo anterior

Si `compare=previous` (default):

- Backend calcula `periodMs = to - from`
- Periodo previo: `[from - periodMs, from)`
- Todas las métricas `_in_range` se calculan también para ese periodo
- Devuelve `_delta_pct = (curr - prev) / prev * 100`, redondeado a 1 decimal
- Si `prev == 0 && curr > 0` → `100` (evita división por cero)
- Si `prev == 0 && curr == 0` → `0`

Si `compare=none`:
- `range.previous: null`
- Todos los `_delta_pct: null`
- Más rápido (menos queries)

### Timezone-aware agrupaciones

Las queries de time series usan `(created_at AT TIME ZONE :tz)::date` para que eventos cerca de medianoche caigan en el día correcto según la zona horaria del usuario. Default `America/La_Paz` (UTC-4).

Sin esta lógica, un evento del 9 jun 23:30 en La Paz se reportaría como del 10 jun en UTC.

### Reset completion ratio

`reset_completion_pct` es ratio puro de eventos en el rango. **NO** es cohort tracking real:

- Si un usuario solicita reset el día 1 y completa el día 5, y consultás rango `[día 3, día 7]` → conteo: 0 requested, 1 completed → pct nonsense
- Para cohort real haría falta agregar `password_reset_id` a ambos eventos y trackear paths individuales. Pendiente.

## 12. Eventos que alimentan el reporte

Acciones registradas en `audit_logs` que las queries leen:

| Action | Cuándo se emite |
|--------|------------------|
| `auth.register` | nuevo signup |
| `auth.login.success` | login OK |
| `auth.login.failed` | login fallido (metadata.reason: `bad_password`, `user_not_found`, `account_locked`, `account_deleted`, etc) |
| `auth.logout` | logout manual |
| `auth.token.refreshed` | refresh exitoso |
| `auth.token.theft_detected` | refresh token viejo reutilizado → familia revocada |
| `auth.password.reset_requested` | forgot-password |
| `auth.password.reset_completed` | reset-password exitoso |
| `auth.password.changed` | password change desde sesión activa |
| `user.profile.updated` | PATCH /auth/me |

Si agregás más acciones al SSO, el endpoint las verá automáticamente. Las queries son agnósticas: filtran por `action=` y leen `metadata->>'reason'` si existe.

## 13. Notas para el frontend

1. **Polling vs manual:** mejor `refresh()` manual con botón. Auto-polling cada 30s es overkill y carga DB.
2. **Diff de rangos:** para "últimos 7 vs 30 días", hacé 2 llamadas con distintos `from`. NO hay un endpoint comparativo dedicado más allá del `previous`.
3. **Time series con días vacíos:** rellenar zeros en frontend si tu chart lo requiere.
4. **Export Excel:** los `_pct` ya vienen redondeados a 1 decimal. No re-formatear.
5. **Refresh tokens activos != usuarios online ahora.** Una persona puede tener varias sesiones (móvil + desktop). Para "users online" haría falta una métrica de "logueados en últimos 5 min", no incluida.
6. **withCredentials: true** en el HTTP client (cookies cross-site del SSO).
7. **Token expirado** → interceptor debe llamar `/auth/refresh` antes de reintentar.
8. **403 esperado** → si user no es admin, redirigir a home (no mostrar dashboard).

## 14. Próximas mejoras evaluadas

| Item | Estado | Razón |
|------|--------|-------|
| Heatmap por hora del día | Pendiente | Útil para reportes semanales (cuando hay más actividad) |
| Engagement buckets (1/2-5/5+ logins por user en rango) | Pendiente | Mide retention |
| Snapshot histórico semanal (tabla `stats_snapshots`) | Pendiente | Permite ver tendencia de `data_quality` a lo largo del tiempo |
| Funnel completo: register → verify → first_login → first_order | Pendiente | Requiere JOIN con DB de API-V6 |
| Cohort retention matriz (W0/W1/W2...) | Deferred | Complejo, mayor valor en >1K usuarios |
| Caching server-side con Redis | Deferred | Solo necesario si latencia >500ms |
| Rate limit dedicado del endpoint | Deferred | Bajo riesgo de abuso (requiere admin) |

## 15. Ejemplos de uso (curl)

```bash
# Login admin → token
TOKEN=$(curl -sS -X POST https://sso.gemmatex.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Client-Id: app_account_portal_prod' \
  -d '{"email":"admin@gemmatex.com.bo","password":"YOUR_PASS"}' | jq -r .access_token)

# Reporte 30 días (default)
curl -sS https://sso.gemmatex.com/api/v1/admin/stats \
  -H "Authorization: Bearer $TOKEN" | jq

# Reporte 7 días con comparación
curl -sS "https://sso.gemmatex.com/api/v1/admin/stats?from=2026-06-04T00:00:00Z&to=2026-06-11T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq

# Junio completo (semi-open)
curl -sS "https://sso.gemmatex.com/api/v1/admin/stats?from=2026-06-01&to=2026-07-01" \
  -H "Authorization: Bearer $TOKEN" | jq

# Sin comparación (más rápido)
curl -sS "https://sso.gemmatex.com/api/v1/admin/stats?compare=none" \
  -H "Authorization: Bearer $TOKEN" | jq

# Solo sección users
curl -sS https://sso.gemmatex.com/api/v1/admin/stats \
  -H "Authorization: Bearer $TOKEN" | jq .users

# Time series para chart
curl -sS https://sso.gemmatex.com/api/v1/admin/stats \
  -H "Authorization: Bearer $TOKEN" | jq .time_series.logins_per_day
```
