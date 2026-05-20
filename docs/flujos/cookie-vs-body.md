# Flujo — Cookie httpOnly vs body JSON

El SSO emite refresh tokens en **2 formas** según el tipo de application:

| Application.type | Refresh transport | Razón |
|---|---|---|
| `spa-web` | Cookie httpOnly | XSS-safe — JS no puede leer cookie |
| `mobile` / `desktop` / `service` | Body JSON | No hay browser, no hay cookies |

## Decisión automática

El SSO inspecciona `application.type` (resolved via `X-Client-Id`) y decide. **Sin opt-in del cliente**: es propiedad de la application.

```
POST /auth/login
X-Client-Id: app_ecommerce_dev    (type=spa-web)
   ↓
Response: cookie + body sin refresh_token

POST /auth/login
X-Client-Id: app_tickets_dev      (type=service)
   ↓
Response: body con refresh_token
```

## Configuración cookie

| Flag | Valor | Por qué |
|---|---|---|
| `HttpOnly` | true | JS no puede leerla → XSS no roba |
| `Secure` | `COOKIE_SECURE` env (true en prod, false dev HTTP) | Solo HTTPS en prod |
| `SameSite` | `Strict` | Bloquea CSRF (cookie no se manda en cross-site) |
| `Path` | `/api/v1/auth` | Solo se envía a endpoints auth, no leaks |
| `Domain` | env (vacío = host actual) | Para subdomains: `.gemmatex.com.bo` |
| `Max-Age` | refresh TTL (7 días) | Sincronizado con expires_at |

## Set-Cookie en login (spa-web)

```
Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800
```

Browser automáticamente almacena. En requests subsecuentes a `/api/v1/auth/*`, la cookie viaja sola.

## Cliente frontend (SPA, ej Vue 3 + Axios)

```js
import axios from 'axios';

export const sso = axios.create({
  baseURL: 'https://sso.gemmatex.com.bo/api/v1',
  withCredentials: true,  // ← CRÍTICO: permite cookies
  headers: { 'X-Client-Id': 'app_ecommerce_prod' },
});

// Login
async function login(email, password) {
  const { data } = await sso.post('/auth/login', { email, password });
  // data.access_token en memoria
  // refresh_token YA está en cookie, no la veas ni la guardes
  return data.user;
}

// Refresh
async function refresh() {
  const { data } = await sso.post('/auth/refresh', {});
  // Cookie rotada automáticamente
  return data.access_token;
}

// Logout
async function logout() {
  await sso.post('/auth/logout', {});
  // Cookie limpiada por servidor
}
```

`withCredentials: true` en Axios es OBLIGATORIO. Sin eso, browser no manda cookies en cross-origin.

## CORS para cookies

Backend debe responder con:
```
Access-Control-Allow-Origin: https://account.gemmatex.com.bo  (NO wildcard *)
Access-Control-Allow-Credentials: true
```

Si usas wildcard `*`, browser RECHAZA la cookie. Por eso `cors({ credentials: true })` exige origin específico.

Config en `.env`:
```
CORS_ORIGINS=https://account.gemmatex.com.bo,https://ecommerce.gemmatex.com.bo
```

## CSRF protection

**`SameSite=Strict`** cubre CSRF en la mayoría de casos modernos:
- Browser no manda cookie en request cross-site (otro origen).
- Atacante no puede forzar al browser a hacer POST con la cookie.

Para defense in depth (futuro): añadir token CSRF doble-submit:
```
Response login:
  Set-Cookie: refresh_token=...
  Body: { csrf_token: '...' }

Cliente envía en headers subsiguientes:
  X-CSRF-Token: <token>

Backend valida match con cookie csrf.
```

No implementado MVP — `SameSite=Strict` suficiente.

## Cookie en mobile/desktop (no aplica)

Apps nativas NO usan cookies HTTP estándar. Reciben refresh_token en body JSON y lo guardan en:
- **iOS**: Keychain (`react-native-keychain`)
- **Android**: Keystore (`react-native-encrypted-storage`)
- **Electron/Tauri**: OS Keychain via safeStorage API

## Endpoint behavior summary

| Endpoint | spa-web | mobile/desktop/service |
|---|---|---|
| `POST /auth/login` | Set-Cookie + body sin refresh | body con refresh |
| `POST /auth/refresh` | Lee cookie, setea nueva cookie | Lee body, devuelve nuevo body |
| `POST /auth/logout` | Lee cookie + Clear-Cookie | Lee body, revoca |
| `POST /auth/accept-invitation` | Set-Cookie + body sin refresh | body con refresh |

## `refresh_in` flag en body

Cuando el SSO usa cookie, el body de respuesta incluye:
```json
{ "refresh_in": "cookie" }
```

Esto le indica al cliente: "no busques refresh_token en body, ya está en tu cookie." Facilita debugging.

## Testing con curl

```bash
# Login (guarda cookie)
curl -c /tmp/cookies.txt \
  -X POST http://localhost:2106/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Client-Id: app_ecommerce_dev" \
  -d '{"email":"...","password":"..."}'

# Refresh (lee y rota cookie)
curl -b /tmp/cookies.txt -c /tmp/cookies.txt \
  -X POST http://localhost:2106/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{}'

# Logout (limpia cookie)
ACCESS=$(curl -b /tmp/cookies.txt http://localhost:2106/api/v1/auth/me -H "Auth..." )
curl -b /tmp/cookies.txt \
  -X POST http://localhost:2106/api/v1/auth/logout \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" -d '{}'
```

## Ventajas / desventajas

### Cookie httpOnly (spa-web)

✓ Inmune a XSS (JS no puede leerla)
✓ Browser maneja todo automático
✓ Más estricto OWASP
✗ Requiere CORS config cuidadoso
✗ `SameSite=Strict` rompe deep-links cross-origin (acceptable trade-off)

### Body JSON (mobile/desktop/service)

✓ Cliente controla 100% el storage
✓ No requiere browser
✓ Más simple en testing manual
✗ Cliente debe usar storage seguro del OS, no archivo plano
✗ Si guarda en lugar inseguro → comprometible

## Producción checklist

- [ ] `COOKIE_SECURE=true` en `.env` prod
- [ ] HTTPS obligatorio (Secure cookies no se envían sobre HTTP)
- [ ] `CORS_ORIGINS` lista explícita de dominios frontend
- [ ] Frontend con `withCredentials: true` en cliente HTTP
- [ ] Considerar `Domain=.gemmatex.com.bo` si compartes cookie entre subdominios
- [ ] Validar SameSite Strict no rompe flujos cross-site requeridos (típicamente no es problema)
