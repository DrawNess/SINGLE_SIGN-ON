# Flujo — Detección de robo de refresh token

Una de las protecciones más importantes del SSO.

## El problema

Atacante roba un `refresh_token` (XSS, malware, dispositivo perdido, etc.). Sin protección:
- Atacante puede emitir access tokens indefinidamente.
- Víctima sigue usando su app sin saber del robo.
- Imposible detectar.

## La solución: family + rotation

Cada login crea un `family_id` UUID v7. Todas las rotaciones del mismo flujo comparten ese `family_id`. Al rotar, el viejo queda `revoked_at` + `replaced_by` apuntando al nuevo.

**Invariante**: cada `family_id` tiene exactamente **un** refresh token activo (no revocado, no expirado) en un momento dado.

Si aparece un segundo refresh activo en la misma family → alguien duplicó.

Más práctico aún: si alguien usa un refresh **ya revocado** → ese alguien no es el legítimo (el legítimo ya hubiera rotado al sucesor).

## Escenario

```
T0: Víctima loguea         → token A (family F1, activo)
T1: Víctima refresca       → token A revocado, token B activo
T2: Atacante roba token B  → token B aún activo
T3: Atacante usa token B   → token B revocado, token C activo
                            (atacante ahora tiene C)
T4: Víctima quiere refrescar → usa token B (su versión guardada)
   → SSO ve B con revoked_at NOT NULL
   → 🚨 DETECCIÓN: revoked pero alguien lo usa
   → REVOCA TODA LA FAMILY F1 (incluye token C del atacante)
   → audit_log action='auth.token.theft_detected'
   → Response 401 TokenTheftDetected a la víctima
```

Resultado:
- Atacante queda fuera (su token C ahora revocado).
- Víctima debe re-loguear (sabe que algo pasó).
- Audit log queda con evidencia.

## Pseudocode (src/services/token.service.js)

```js
async function validateRefreshToken(refreshPlain) {
  const hash = sha256(refreshPlain);
  const row = await RefreshToken.findOne({ where: { token_hash: hash } });

  if (!row) {
    throw new Error('INVALID_REFRESH');  // ni siquiera existe
  }

  if (row.revoked_at) {
    // 🚨 Token revocado pero alguien lo usa → ROBO
    await RefreshToken.update(
      { revoked_at: new Date(), revoked_reason: 'theft_detected' },
      { where: { family_id: row.family_id, revoked_at: null } }
    );
    throw new TheftError({ familyId: row.family_id, userId: row.user_id });
  }

  if (row.expires_at < new Date()) {
    throw new Error('REFRESH_EXPIRED');
  }

  return row;
}
```

## Pseudocode (controller)

```js
async function refresh(req, res, next) {
  try {
    const { tokens, user } = await authService.refresh(req.body.refresh_token, { req });
    res.json({ ...tokens, user });
  } catch (err) {
    if (err.code === 'REFRESH_REVOKED') {
      // audit ya registrado por el service
      return next(new HttpError(401, 'TokenTheftDetected',
        'Sesión comprometida, vuelve a loguear'));
    }
    next(err);
  }
}
```

## Audit log

Cuando se detecta robo:

```json
{
  "action": "auth.token.theft_detected",
  "user_id": "<víctima>",
  "actor_type": "system",
  "ip": "<IP del request actual>",
  "user_agent": "<UA actual>",
  "metadata": { "family_id": "<UUID familia revocada>" },
  "created_at": "..."
}
```

Este evento debe alertar al usuario por email (notificación de seguridad — paso futuro).

## Falsos positivos

¿Puede haber un falso positivo? Sí, raros:

1. **Doble request del cliente legítimo**: cliente envía 2x el refresh por bug de retry. La primera rota OK. La segunda dispara teft.

   **Mitigación**: el cliente debe garantizar idempotencia en `/api/v1/auth/refresh` (no retry sin esperar respuesta).

2. **Race condition**: cliente con 2 pestañas refresca al mismo tiempo. Una gana, la otra falla.

   **Mitigación**: pestañas deben compartir storage de tokens (BroadcastChannel API o storage event en el frontend) para coordinar.

3. **Refresh muy lento, cliente da timeout y retry**: igual al caso 1.

   **Mitigación**: aumentar timeout del cliente. El refresh tarda <100ms normalmente.

Si hay falsos positivos frecuentes en producción, considera:
- Tolerancia: aceptar el refresh viejo durante 5 segundos tras rotar (grace period).
- Storage compartido cliente-side mejor.

## ¿Por qué revocar TODA la family?

Alternativa: solo revocar el actual.

Pero: el atacante ya rotó al token C. Si solo revocamos B (el víctima), el atacante mantiene C activo. Para asegurar que el atacante también pierde acceso:
- Revocamos C también, y todos los predecesores.
- Es decir: TODA la family.

Esto significa que la víctima debe re-loguear. Inconveniente pero necesario: no podemos distinguir cuál de los dos es legítimo (víctima vs atacante), así que invalidamos todo.

## Comparación con otros sistemas

| Sistema | Mecanismo |
|---|---|
| **SSO GEMMATEX** | family + rotation + theft detection |
| Auth0 | Refresh token rotation + reuse detection (mismo concepto) |
| Firebase Auth | Refresh token long-lived, sin rotation por defecto |
| Cognito | Sin rotation por defecto, configurable |
| Keycloak | Rotation opcional |

Lo que hace el SSO GEMMATEX está alineado con [RFC 6819](https://datatracker.ietf.org/doc/html/rfc6819) (OAuth 2.0 Threat Model) y [OAuth 2.0 BCP](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics).

## Limpieza periódica

Los tokens revocados quedan en DB para auditoría. Conviene un cron que limpie los muy viejos:

```sql
DELETE FROM refresh_tokens
WHERE revoked_at IS NOT NULL
  AND revoked_at < NOW() - INTERVAL '90 days';
```

Pendiente implementar como job nocturno (paso futuro).
