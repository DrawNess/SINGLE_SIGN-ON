# Claves RS256 (JWT)

El SSO firma JWT con **RS256** (RSA 4096 bits). Las claves se generan localmente y NO se commitean.

## Generar par inicial

```bash
npm run keys:generate
```

Salida:
```
→ Generando par RSA 4096 bits...
✔ Privada: /.../src/keys/private.pem (chmod 600)
✔ Pública: /.../src/keys/public.pem
```

Crea:
- `src/keys/private.pem` — Permisos `600` (solo dueño). **JAMÁS commitear.**
- `src/keys/public.pem` — Permisos `644`. Expuesta vía JWKS.

## Sobrescribir

`npm run keys:generate` falla si ya existen claves. Para forzar:

```bash
node scripts/generate-keys.js --force
```

⚠ Sobrescribir invalida TODOS los tokens emitidos previamente — clientes deben re-loguear.

## Distribución a otros microservicios

**NO** copies `public.pem` manualmente a otros servicios. Mejor: que descarguen del endpoint JWKS y cacheen:

```js
// En el backend de Tickets, ejemplo con jose
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://sso.gemmatex.com/.well-known/jwks.json'),
  { cacheMaxAge: 3600 * 1000 }   // 1 hora
);

async function verify(token) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: 'sso.gemmatex.com',
    audience: 'tickets',
  });
  return payload;
}
```

Ventajas:
- Rotación de claves sin redeployar los micros.
- Misma clave para todos sin compartir archivos.

## Rotación de claves

Buen práctica: rotar cada 6-12 meses, o inmediato si sospechas compromiso.

### Procedimiento

1. **Generar par nuevo** con `kid` distinto:
   ```bash
   # Opcionalmente respaldar el actual
   mv src/keys/private.pem src/keys/private.pem.old
   mv src/keys/public.pem src/keys/public.pem.old
   node scripts/generate-keys.js --force
   ```

2. **Actualizar `JWT_KID` en `.env`**:
   ```
   JWT_KID=key-2026-06   # antes era key-2026-01
   ```

3. **(Opcional) Servir ambas claves en JWKS** durante el periodo de transición:
   - Modifica `src/utils/jwks.js` para incluir ambas en el array `keys[]`.
   - Tras `JWT_ACCESS_TTL` (15min) + `JWT_REFRESH_TTL_DAYS` (7d), todos los tokens viejos han expirado → puedes quitar la pública vieja del JWKS.

4. **Restart SSO**:
   ```bash
   npm run dev   # o tu proceso prod
   ```

Tokens viejos (firmados con clave vieja) **siguen siendo válidos** mientras la pública vieja esté en JWKS. Tokens nuevos llevan el nuevo `kid` y verifican contra la nueva pública.

## Estructura del JWKS

`GET /.well-known/jwks.json` retorna:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "key-2026-01",
      "n": "lKkS-3xpb2agBQHAvq3yu9...",
      "e": "AQAB"
    }
  ]
}
```

Cuando un cliente verifica un JWT:
1. Decodifica header → obtiene `kid`.
2. Busca en `keys[]` el que tenga ese `kid`.
3. Usa esa clave para verificar firma.

## Producción

⚠ En producción, las claves DEBEN venir de un **secret manager**:

- AWS Secrets Manager
- Google Secret Manager
- HashiCorp Vault
- Kubernetes Secrets

No archivos en disco. El bootstrap de la app las lee al arrancar y las mantiene en memoria.

Modificación recomendada en `src/config/env.js` para producción:
```js
if (config.isProd) {
  const secretsManager = require('aws-sdk').SecretsManager(...);
  jwtPrivateKey = await secretsManager.getSecretValue({SecretId: 'sso/jwt-private'})...
}
```

## Backup de claves

⚠ Si pierdes la privada, todos los tokens activos son inválidos (clientes deben re-loguear). No es catastrófico (refresh tokens viven en DB), pero molesto.

Backup en gestor de secretos como artefacto cifrado adicional. Restaura mismo `kid` para no romper JWKS.
