# Integración con frontend `account.gemmatex.com.bo`

Los emails del SSO **NO apuntan a la API directamente**. Apuntan al frontend portal de cuenta (Universal Login pattern, estilo `account.google.com` / `account.samsung.com`).

## Arquitectura

```
┌─────────────────────────────┐         ┌────────────────────────────┐
│   account.gemmatex.com.bo   │ ─────►  │   sso.gemmatex.com.bo      │
│   (frontend portal)         │  API    │   (este servicio)          │
│                             │  REST   │                            │
│   - /verify-email           │         │   /api/v1/auth/*           │
│   - /reset-password         │         │   /.well-known/jwks.json   │
│   - /confirm-email-change   │         │                            │
│   - /login                  │         │                            │
│   - /profile (futuro)       │         │                            │
└─────────────────────────────┘         └────────────────────────────┘
              ▲
              │ click en email
              │
       ┌──────┴─────────┐
       │  email Gmail   │
       │  link branded  │
       └────────────────┘
```

## Flujo: verificación de email

```
1. Usuario se registra
     │
     ▼
2. SSO genera token + envía email branded
   Link en email: https://account.gemmatex.com.bo/verify-email?token=ABC
     │
     ▼
3. Usuario click → abre frontend portal
     │
     ▼
4. Frontend (account.gemmatex.com.bo):
   - Lee ?token=ABC del query
   - Muestra spinner "Verificando..."
   - POST https://sso.gemmatex.com.bo/api/v1/auth/verify-email
        Body: { token: 'ABC' }
     │
     ▼
5. SSO valida y responde:
   - 200 { mode: 'registration', message }
   - 400 InvalidToken / TokenExpired / TokenAlreadyUsed
     │
     ▼
6. Frontend muestra:
   - Éxito: "✓ Cuenta activada. Redirigiendo a login..."
     → setTimeout(3s) redirect a /login
   - Error: "Este link expiró. ¿Pedir uno nuevo?"
     → botón a /resend-verification
```

## Flujo: reset password

```
1. Usuario click "Olvidé mi contraseña" en cualquier app consumidora
     │
     ▼
2. Frontend → POST /api/v1/auth/forgot-password { email }
     │
     ▼
3. SSO genera token + envía email
   Link: https://account.gemmatex.com.bo/reset-password?token=ABC
     │
     ▼
4. Usuario click → abre frontend
     │
     ▼
5. Frontend muestra form: "Nueva contraseña" + "Confirmar"
     │
     ▼
6. Frontend → POST /api/v1/auth/reset-password
              { token, new_password }
     │
     ▼
7. Frontend: "✓ Contraseña cambiada" → redirect /login
```

## Flujo: cambio de email

```
1. Usuario logueado pide cambio de email desde alguna app
     │
     ▼
2. Frontend (app consumidora) → POST /api/v1/auth/change-email
              { new_email, current_password }
   Auth: Bearer JWT del usuario
     │
     ▼
3. SSO envía email AL NUEVO destino:
   Link: https://account.gemmatex.com.bo/confirm-email-change?token=ABC
     │
     ▼
4. Usuario revisa NUEVO inbox → click
     │
     ▼
5. Frontend portal:
   - POST /api/v1/auth/verify-email { token }  (mismo endpoint)
   - SSO detecta new_email NOT NULL → mode='email_change'
     │
     ▼
6. Frontend: "✓ Email cambiado. Vuelve a iniciar sesión."
   Todos los refresh tokens revocados → re-login obligatorio.
```

## Páginas mínimas del frontend portal

| Ruta | Función | Endpoint API que consume |
|---|---|---|
| `/login` | Login + recordar email | `POST /api/v1/auth/login` |
| `/register` | Form de registro | `POST /api/v1/auth/register` |
| `/verify-email?token=` | Procesa link del email | `POST /api/v1/auth/verify-email` |
| `/confirm-email-change?token=` | Confirma cambio | `POST /api/v1/auth/verify-email` (mismo) |
| `/forgot-password` | Pide email para reset | `POST /api/v1/auth/forgot-password` (paso 3D) |
| `/reset-password?token=` | Form de nueva password | `POST /api/v1/auth/reset-password` (paso 3D) |
| `/verify-phone?code=` | Validar código SMS | `POST /api/v1/auth/verify-phone` (paso 3C) |
| `/2fa/setup` | Activar 2FA con QR | `POST /api/v1/auth/2fa/setup` (paso 3E) |
| `/profile` | Editar datos (futuro) | `GET/PATCH /api/v1/auth/me` |

## Headers que el frontend debe enviar

Para login / register:
```
Content-Type: application/json
X-Client-Id: app_account_portal_prod
```

Sí, `account.gemmatex.com.bo` también es una **application** registrada en la tabla `applications`. Tipo `spa-web`, audience propia. Esto permite emitir tokens específicos para el portal.

**Sugerencia seed**: añadir `account-portal` como app en `applications` para el frontend `account.gemmatex.com.bo`.

## Tokens en el frontend portal

Mismo patrón que cualquier SPA:
- `access_token` (JWT 15min) → en memoria (variable JS)
- `refresh_token` → cookie `httpOnly + Secure + SameSite=Strict` (próxima iteración, paso 3I)

⚠ **Nunca** en `localStorage`. Vulnerable XSS.

## Stack sugerido para el frontend portal

| Cosa | Sugerencia |
|---|---|
| Framework | Vue 3 + Vite (lo que ya usas) o React + Vite |
| Routing | Vue Router / React Router |
| HTTP client | Axios o fetch nativo |
| State | Pinia / Zustand |
| UI | Tailwind + componentes propios, o Vuetify, o MUI |
| Forms + validation | VeeValidate, Zod, Joi (mismo del backend) |

## Manejo de errores en el frontend

| Error API | UI sugerida |
|---|---|
| `400 InvalidToken` | "Este enlace no es válido. Pide uno nuevo." |
| `400 TokenExpired` | "Este enlace expiró. Pide uno nuevo." |
| `400 TokenAlreadyUsed` | "Ya verificaste este correo. Inicia sesión." |
| `400 ValidationError` | mostrar `details[]` campo por campo |
| `401 InvalidCredentials` | "Email o contraseña incorrectos." |
| `403 AccountPending` | "Verifica tu correo antes de iniciar sesión. Reenviar email." |
| `423 AccountLocked` | "Cuenta bloqueada temporalmente. Reintenta tras {time}." |
| `409 EmailInUse` | "Ese email ya tiene cuenta. ¿Iniciar sesión?" |
| `5xx` | "Error del servidor. Reintenta más tarde." + link a soporte |

## Ejemplo Vue 3 — página `/verify-email`

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';

const route = useRoute();
const router = useRouter();
const state = ref('loading');  // loading | success | error
const message = ref('');
const errorCode = ref(null);

onMounted(async () => {
  const token = route.query.token;
  if (!token) {
    state.value = 'error';
    message.value = 'Link inválido. Falta el token.';
    return;
  }
  try {
    const { data } = await axios.post(
      `${import.meta.env.VITE_SSO_API_URL}/api/v1/auth/verify-email`,
      { token }
    );
    state.value = 'success';
    message.value = data.message;
    setTimeout(() => router.push('/login'), 3000);
  } catch (err) {
    state.value = 'error';
    errorCode.value = err.response?.data?.error;
    message.value = err.response?.data?.message || 'Error desconocido';
  }
});
</script>

<template>
  <div class="container">
    <div v-if="state === 'loading'">
      <Spinner /> Verificando tu correo...
    </div>
    <div v-else-if="state === 'success'" class="success">
      ✓ {{ message }}
      <p>Redirigiendo a inicio de sesión...</p>
    </div>
    <div v-else class="error">
      <p>{{ message }}</p>
      <RouterLink
        v-if="errorCode === 'TokenExpired' || errorCode === 'InvalidToken'"
        to="/resend-verification"
      >
        Enviar nuevo enlace
      </RouterLink>
    </div>
  </div>
</template>
```

## .env del frontend portal

```
VITE_SSO_API_URL=https://sso.gemmatex.com.bo
VITE_PORTAL_NAME=Account Gemmatex
```

## CORS

El SSO debe permitir requests desde `account.gemmatex.com.bo`. Configura en `.env` del SSO:

```
CORS_ORIGINS=https://account.gemmatex.com.bo,https://ecommerce.gemmatex.com.bo
```

O añade `account.gemmatex.com.bo` al `allowed_origins` de la application correspondiente en DB.

## En desarrollo sin frontend listo

Default `.env` apunta a `http://localhost:3000`. Si aún no tienes frontend:

- Opción A: copia el token de la URL del email y úsalo manualmente:
  ```bash
  curl -X POST http://localhost:2106/api/v1/auth/verify-email \
    -d '{"token":"<token-del-email>"}'
  ```
- Opción B: cambia temporalmente `EMAIL_VERIFY_URL_TEMPLATE` en `.env` a la URL de la API:
  ```
  EMAIL_VERIFY_URL_TEMPLATE=http://localhost:2106/api/v1/auth/verify-email?token={token}
  ```
  Click directo en el email → llama API directo via GET. Solo para dev.

## Próximos pasos

Cuando comencemos el frontend portal (`account.gemmatex.com.bo`), crear:

- [ ] Repo separado `account-portal` (Vue 3 + Vite)
- [ ] Páginas: login, register, verify-email, confirm-email-change, reset-password, profile
- [ ] Componentes: Layout branded Gemmatex (mismo logo + color #0b5ed7 de emails)
- [ ] Axios instance configurado con `X-Client-Id`
- [ ] Manejo automático de refresh tokens
- [ ] Deploy en Vercel / Netlify / VPS con HTTPS

Por ahora se puede testear todo el SSO via curl. Frontend separado al MVP.
