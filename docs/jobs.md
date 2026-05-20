# Jobs / Cron

Jobs internos del SSO ejecutados con `node-cron` en el mismo proceso.

## Jobs activos

| Job | Schedule | Función |
|---|---|---|
| `cleanup-tokens` | `0 3 * * *` (3am daily, America/La_Paz) | Borra tokens revocados/expirados antiguos |

## `cleanup-tokens`

Job de limpieza periódica. Borra:

| Tabla | Criterio | Default retención |
|---|---|---|
| `refresh_tokens` | `revoked_at` o `expires_at` antes del cutoff | 90 días |
| `email_verifications` | `used_at` o `expires_at` antes del cutoff | 30 días |
| `password_resets` | `used_at` o `expires_at` antes del cutoff | 30 días |
| `phone_verifications` | `used_at` o `expires_at` antes del cutoff | 30 días |
| `audit_logs` | `created_at` antes del cutoff | 365 días |

### Por qué retención larga en `audit_logs`

Compliance / forense. Si detectas un robo HOY pero la actividad pasó hace meses, necesitas el historial. Default 1 año, configurable.

### Distributed lock

Si tienes N réplicas del SSO, todas tienen el cron registrado. Solo UNA ejecuta:

```sql
SELECT pg_try_advisory_lock(92348923489234)
```

La primera réplica que llega adquiere el lock. Las otras ven `false` y hacen skip. Tras terminar, libera con `pg_advisory_unlock`.

Sin lock distribuido → N réplicas borrarían lo mismo a la vez (queries concurrentes lentas, no daño real).

### Output

Cada ejecución imprime en consola:
```
[job:cleanup] arrancando...
[job:cleanup] OK {"refresh_tokens":234,"email_verifications":56,"password_resets":12,"phone_verifications":0,"audit_logs":890,"skipped":false,"duration_ms":523}
```

### Ejecutar manual (testing/ad-hoc)

```bash
node -e "
const { sequelize } = require('./src/db/models');
const { cleanupTokens } = require('./src/jobs/cleanup-tokens.job');
(async () => {
  const stats = await cleanupTokens();
  console.log(stats);
  await sequelize.close();
})();
"
```

Útil para validar antes de habilitar cron o tras incidente.

## Configuración `.env`

```
JOBS_ENABLED=true
JOBS_CLEANUP_TOKENS_CRON=0 3 * * *

JOBS_CLEANUP_REFRESH_TOKENS_DAYS=90
JOBS_CLEANUP_EMAIL_TOKENS_DAYS=30
JOBS_CLEANUP_PASSWORD_RESETS_DAYS=30
JOBS_CLEANUP_PHONE_VERIFICATIONS_DAYS=30
JOBS_CLEANUP_AUDIT_LOGS_DAYS=365
```

`JOBS_ENABLED=false` → no se registra ningún cron. Útil para:
- Tests
- Deploy single-shot
- Cuando externalizas cron a Postgres `pg_cron` o k8s CronJob

## Cambiar el schedule

Sintaxis cron estándar 5 campos: `min hour day-month month day-week`.

Ejemplos:
- `0 3 * * *` → 3am diario
- `0 */6 * * *` → cada 6 horas
- `0 0 * * 0` → domingos 0am
- `*/10 * * * *` → cada 10 min (NO recomendado, overhead alto)

## Timezone

Default `America/La_Paz`. Si despliegas en otro huso, cambiar en `src/jobs/index.js`:

```js
cron.schedule(cronExpr, fn, { timezone: 'America/La_Paz' });
```

## Próximos jobs (futuro)

| Job | Función |
|---|---|
| `prune-old-sessions` | Marca como revocados refresh tokens cuyo `last_used_at` >30 días |
| `metrics-snapshot` | Calcula stats diarios (logins, registros, etc.) para dashboard |
| `unverified-cleanup` | Borra users `status=pending` con >7 días sin verificar |
| `failed-login-reports` | Envía email semanal con top IPs sospechosas |

## Producción

⚠ En clusters Kubernetes considera externalizar:

**Opción A — k8s CronJob** (recomendado prod):
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sso-cleanup-tokens
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: cleanup
              image: sso-gemmatex:latest
              command: ["node", "scripts/run-cleanup.js"]
```

+ desactivar `JOBS_ENABLED=false` en pods regulares.

**Opción B — pg_cron** (extension Postgres):
```sql
CREATE EXTENSION pg_cron;
SELECT cron.schedule('cleanup', '0 3 * * *', $$
  DELETE FROM refresh_tokens WHERE revoked_at < NOW() - INTERVAL '90 days';
$$);
```
Limpio, sin proceso Node corriendo cron.

**MVP**: node-cron en proceso. Suficiente.
