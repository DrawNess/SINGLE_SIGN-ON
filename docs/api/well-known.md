# API — `/.well-known/jwks.json`

Endpoint público que expone la clave pública RSA usada para firmar JWT.

⚠ **NO** está bajo `/api/v1/`. La ruta `.well-known/jwks.json` es un **estándar** ([RFC 8615](https://datatracker.ietf.org/doc/html/rfc8615) + [RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517)) — vive en la raíz del servidor por convención. Las libs JWT modernas (jose, jsonwebtoken) la buscan ahí por defecto.

## GET `/.well-known/jwks.json`

**Sin autenticación**. Cualquier microservicio puede consumirla.

### Headers respuesta
```
Content-Type: application/json
Cache-Control: public, max-age=3600
```

Se recomienda cachear 1 hora en los consumidores.

### Respuesta 200
```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "key-2026-01",
      "n": "lKkS-3xpb2agBQHAvq3yu9boqdkAdwJcipcs80aeWKWO5e6NamKxj-bjPVbFeuMtULD...",
      "e": "AQAB"
    }
  ]
}
```

### Formato JWK

Cada clave en `keys[]` cumple [RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517):

| Campo | Valor |
|---|---|
| `kty` | `RSA` |
| `use` | `sig` (firma, no encriptación) |
| `alg` | `RS256` |
| `kid` | Identificador único — coincide con el `kid` del header del JWT |
| `n` | Módulo RSA (base64url) |
| `e` | Exponente RSA (base64url, normalmente `AQAB` = 65537) |

## Cómo lo usan otros microservicios

```js
// Tickets backend (Node.js + jose lib)
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://sso.gemmatex.com/.well-known/jwks.json'),
  { cacheMaxAge: 3600 * 1000 }
);

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: 'sso.gemmatex.com',
    audience: 'tickets',
  });
  return payload;
}
```

`createRemoteJWKSet` se encarga de:
- Descargar el JWKS al primer uso.
- Cachear por `cacheMaxAge` ms.
- Buscar la clave correcta por el `kid` del token.
- Refetch si aparece un `kid` desconocido (rotación).

## Múltiples claves (rotación)

Durante una rotación, el array `keys[]` puede tener N entradas:

```json
{
  "keys": [
    { "kid": "key-2026-06", ... },   // nueva
    { "kid": "key-2026-01", ... }    // vieja, tokens activos aún la usan
  ]
}
```

Cuando todos los tokens emitidos con `key-2026-01` hayan expirado (15 min access + 7 días refresh), puedes quitar esa entrada del JWKS.

## Por qué JWKS y no archivo compartido

| Archivo `.pem` compartido | JWKS endpoint |
|---|---|
| Cada micro copia manualmente | Auto-download |
| Difícil rotar (re-copiar a todos) | Rotación transparente |
| No estándar | RFC 7517, soportado por todas las libs JWT |
| Sin metadata (`kid`, `alg`) | Trae metadata estándar |

JWKS es el estándar OAuth/OIDC. Cualquier lib JWT moderna lo entiende.

## Producción

- Servir tras CDN (Cloudflare, etc.) para reducir carga del SSO.
- HTTPS obligatorio (sin TLS, MITM puede inyectar clave falsa).
- Headers de cache largos (`max-age=3600` razonable).
- Si rotas: invalida cache CDN para acelerar propagación.

## Endpoint OIDC Discovery (opcional, futuro)

Estándar OIDC también define `/.well-known/openid-configuration`:

```json
{
  "issuer": "https://sso.gemmatex.com",
  "jwks_uri": "https://sso.gemmatex.com/.well-known/jwks.json",
  "token_endpoint": "https://sso.gemmatex.com/api/v1/auth/login",
  "authorization_endpoint": "https://sso.gemmatex.com/api/v1/auth/authorize",
  ...
}
```

Esto permite descubrimiento automático completo. No implementado MVP (no es necesario si los micros configuran issuer + JWKS URL en su `.env`).
