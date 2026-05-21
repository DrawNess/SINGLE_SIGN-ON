# Frontend `account.gemmatex.com.bo` — Guía completa

Portal único de gestión de cuenta. Stack: **Angular 21+ standalone** (probado con 21.1.x).

## Arquitectura

```
┌───────────────────────────────────────────┐
│  account.gemmatex.com.bo                  │
│  Angular SPA                              │
│                                           │
│  Páginas auth:                            │
│   /login, /register, /verify-email,       │
│   /reset-password, /forgot-password,      │
│   /accept-invitation, /confirm-email-change│
│                                           │
│  Páginas dashboard (requireAuth):         │
│   /, /profile, /security, /sessions       │
│                                           │
│  Futuro (paso 3J):                        │
│   /authorize  ← OAuth code flow           │
└──────────────┬────────────────────────────┘
               │ HttpClient + withCredentials
               ▼
       sso.gemmatex.com.bo
       (esta API)
```

## Setup inicial

```bash
npm install -g @angular/cli
ng new account-portal --routing --style=css --ssr=false
cd account-portal
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

## Variables de entorno

`src/environments/environment.ts`:
```ts
export const environment = {
  production: false,
  ssoApiUrl: 'http://localhost:2106',
  ssoClientId: 'app_account_portal_dev',
  // Futuro OAuth (paso 3J)
  oauthEnabled: false,
};
```

`src/environments/environment.prod.ts`:
```ts
export const environment = {
  production: true,
  ssoApiUrl: 'https://sso.gemmatex.com.bo',
  ssoClientId: 'app_account_portal_prod',
  oauthEnabled: true,
};
```

## Estructura carpetas

```
src/
├── app/
│   ├── core/
│   │   ├── auth/
│   │   │   ├── auth.service.ts          ← Signals + login/logout/refresh
│   │   │   ├── auth.interceptor.ts      ← Attach token + auto-refresh
│   │   │   ├── auth.guard.ts            ← CanActivateFn
│   │   │   └── auth.types.ts            ← User, Tokens interfaces
│   │   ├── api/
│   │   │   ├── sso-api.service.ts       ← HttpClient wrapper
│   │   │   └── endpoints.ts             ← URLs centralizadas
│   │   └── interceptors/
│   │       └── error.interceptor.ts     ← Map errores API a notif
│   ├── shared/
│   │   ├── components/
│   │   │   ├── auth-layout/             ← Card centered
│   │   │   ├── app-layout/              ← Sidebar dashboard
│   │   │   ├── form-field/              ← Input reusable
│   │   │   └── password-field/          ← Input con toggle
│   │   └── validators/
│   │       └── password.validator.ts    ← Strong password
│   ├── features/
│   │   ├── auth/
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   ├── forgot-password/
│   │   │   ├── reset-password/
│   │   │   ├── verify-email/
│   │   │   ├── accept-invitation/
│   │   │   └── confirm-email-change/
│   │   ├── account/
│   │   │   ├── dashboard/
│   │   │   ├── profile/
│   │   │   ├── security/
│   │   │   └── sessions/
│   │   └── oauth/                       ← futuro paso 3J
│   │       └── authorize/
│   └── app.routes.ts
├── environments/
└── styles.css                           ← Tailwind imports
```

## Páginas a construir (orden sugerido)

### Fase 1: Auth pública

| Página | Endpoint backend | Notas |
|---|---|---|
| `/login` | `POST /api/v1/auth/login` | Query param `?return=...` para redirect post-login |
| `/register` | `POST /api/v1/auth/register` | Todos campos client_profile |
| `/forgot-password` | `POST /api/v1/auth/forgot-password` | Anti-enum: siempre OK |
| `/reset-password?token=` | `POST /api/v1/auth/reset-password` | Extrae token de query |
| `/verify-email?token=` | `POST /api/v1/auth/verify-email` | Token → llamada → mensaje |
| `/confirm-email-change?token=` | `POST /api/v1/auth/verify-email` | Mismo endpoint, diff mensaje |
| `/accept-invitation?token=` | `POST /api/v1/auth/accept-invitation` | Form admin nuevo |

### Fase 2: Dashboard (autenticado)

| Página | Endpoint | Notas |
|---|---|---|
| `/` | `GET /api/v1/auth/me` | Resumen cuenta |
| `/profile` | `GET, PATCH /api/v1/auth/me` | Editar profile cliente/admin |
| `/security` | `POST /api/v1/auth/change-password` | + cambio email |
| | `POST /api/v1/auth/change-email` | |
| `/sessions` | `GET, DELETE /api/v1/auth/sessions` | Lista + revocar dispositivos |
| | `POST /api/v1/auth/sessions/logout-others` | Cerrar otras |

### Fase 3 (paso 3J): OAuth flow

| Página | Notas |
|---|---|
| `/authorize` | Recibe `?client_id=&redirect_uri=&state=...`, valida sesión SSO, llama backend, redirige a app |

## Auth Service (Angular Signals)

```ts
// src/app/core/auth/auth.service.ts
import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

interface User {
  id: string;
  email: string;
  status: string;
  roles: string[];
  // ... etc
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private _user = signal<User | null>(null);
  private _accessToken = signal<string | null>(null);

  user = this._user.asReadonly();
  accessToken = this._accessToken.asReadonly();
  isAuthenticated = computed(() => !!this._accessToken());
  isAdmin = computed(() =>
    this._user()?.roles?.some(r => ['admin', 'super_admin'].includes(r)) ?? false
  );

  async login(email: string, password: string): Promise<void> {
    const res: any = await firstValueFrom(
      this.http.post(`${environment.ssoApiUrl}/api/v1/auth/login`, {
        email, password,
      }, {
        withCredentials: true,
        headers: { 'X-Client-Id': environment.ssoClientId },
      })
    );
    this._accessToken.set(res.access_token);
    this._user.set(res.user);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(
        `${environment.ssoApiUrl}/api/v1/auth/logout`,
        {},
        { withCredentials: true }
      ));
    } catch {}
    this._accessToken.set(null);
    this._user.set(null);
    this.router.navigate(['/login']);
  }

  /** Llamado al boot del app. Recupera sesión con cookie httpOnly. */
  async tryRefresh(): Promise<boolean> {
    try {
      const res: any = await firstValueFrom(this.http.post(
        `${environment.ssoApiUrl}/api/v1/auth/refresh`,
        {},
        {
          withCredentials: true,
          headers: { 'X-Client-Id': environment.ssoClientId },
        }
      ));
      this._accessToken.set(res.access_token);
      this._user.set(res.user);
      return true;
    } catch {
      return false;
    }
  }

  setAccessToken(t: string) { this._accessToken.set(t); }
  clearAuth() {
    this._accessToken.set(null);
    this._user.set(null);
  }
}
```

## HTTP Interceptor (functional, Angular 16+)

```ts
// src/app/core/auth/auth.interceptor.ts
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { catchError, switchMap, throwError, from, of } from 'rxjs';
import { environment } from '../../../environments/environment';

let refreshing: Promise<string | null> | null = null;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  // Asegura withCredentials para todos requests al SSO
  let cloned = req;
  if (req.url.startsWith(environment.ssoApiUrl)) {
    cloned = req.clone({
      withCredentials: true,
      setHeaders: {
        ...(auth.accessToken() ? { Authorization: `Bearer ${auth.accessToken()}` } : {}),
        'X-Client-Id': environment.ssoClientId,
      },
    });
  }

  return next(cloned).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401 || req.url.includes('/auth/refresh') || req.url.includes('/auth/login')) {
        return throwError(() => err);
      }
      // Intenta refresh único, encolando otras 401
      if (!refreshing) {
        refreshing = auth.tryRefresh().then((ok) => {
          refreshing = null;
          return ok ? auth.accessToken() : null;
        });
      }
      return from(refreshing).pipe(
        switchMap((newToken) => {
          if (!newToken) {
            auth.clearAuth();
            return throwError(() => err);
          }
          const retry = req.clone({
            withCredentials: true,
            setHeaders: { Authorization: `Bearer ${newToken}` },
          });
          return next(retry);
        })
      );
    })
  );
};
```

Wire en `app.config.ts`:
```ts
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './core/auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    // ...
  ],
};
```

## Route Guards (functional)

```ts
// src/app/core/auth/auth.guard.ts
import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login'], { queryParams: { return: state.url } });
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? router.createUrlTree(['/']) : true;
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAdmin() ? true : router.createUrlTree(['/']);
};
```

## Routes

```ts
// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { AuthLayoutComponent } from './shared/components/auth-layout/auth-layout.component';
import { AppLayoutComponent } from './shared/components/app-layout/app-layout.component';

export const routes: Routes = [
  {
    path: '',
    component: AuthLayoutComponent,
    canActivate: [guestGuard],
    children: [
      { path: 'login', loadComponent: () => import('./features/auth/login/login.component').then(m => m.LoginComponent) },
      { path: 'register', loadComponent: () => import('./features/auth/register/register.component').then(m => m.RegisterComponent) },
      { path: 'forgot-password', loadComponent: () => import('./features/auth/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent) },
      { path: 'reset-password', loadComponent: () => import('./features/auth/reset-password/reset-password.component').then(m => m.ResetPasswordComponent) },
      { path: 'verify-email', loadComponent: () => import('./features/auth/verify-email/verify-email.component').then(m => m.VerifyEmailComponent) },
      { path: 'confirm-email-change', loadComponent: () => import('./features/auth/verify-email/verify-email.component').then(m => m.VerifyEmailComponent) },
      { path: 'accept-invitation', loadComponent: () => import('./features/auth/accept-invitation/accept-invitation.component').then(m => m.AcceptInvitationComponent) },
    ],
  },
  {
    path: '',
    component: AppLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', loadComponent: () => import('./features/account/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'profile', loadComponent: () => import('./features/account/profile/profile.component').then(m => m.ProfileComponent) },
      { path: 'security', loadComponent: () => import('./features/account/security/security.component').then(m => m.SecurityComponent) },
      { path: 'sessions', loadComponent: () => import('./features/account/sessions/sessions.component').then(m => m.SessionsComponent) },
    ],
  },
  // Futuro paso 3J:
  // { path: 'authorize', loadComponent: () => import('./features/oauth/authorize/authorize.component').then(m => m.AuthorizeComponent) },
  { path: '**', redirectTo: '/login' },
];
```

## Boot recovery (recuperar sesión al refresh F5)

```ts
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { AuthService } from './app/core/auth/auth.service';

(async () => {
  const app = await bootstrapApplication(AppComponent, appConfig);
  const auth = app.injector.get(AuthService);
  await auth.tryRefresh();  // intenta refresh con cookie httpOnly
})();
```

## CORS en backend SSO

`.env` del SSO debe permitir tu origen:
```
CORS_ORIGINS=http://localhost:4200,https://account.gemmatex.com.bo
```

`localhost:4200` = puerto default `ng serve`.

## Componente Login ejemplo

```ts
// src/app/features/auth/login/login.component.ts
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="space-y-4">
      <h1 class="text-2xl font-bold">Iniciar sesión</h1>

      <div>
        <label class="block text-sm font-medium">Email</label>
        <input type="email" formControlName="email"
               class="mt-1 w-full rounded border px-3 py-2"
               autocomplete="email" />
      </div>

      <div>
        <label class="block text-sm font-medium">Contraseña</label>
        <input type="password" formControlName="password"
               class="mt-1 w-full rounded border px-3 py-2"
               autocomplete="current-password" />
      </div>

      @if (error()) {
        <p class="text-sm text-red-600">{{ error() }}</p>
      }

      <button type="submit" [disabled]="form.invalid || loading()"
              class="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        {{ loading() ? 'Iniciando...' : 'Iniciar sesión' }}
      </button>

      <div class="flex justify-between text-sm">
        <a routerLink="/forgot-password" class="text-blue-600">¿Olvidé mi contraseña?</a>
        <a routerLink="/register" class="text-blue-600">Crear cuenta</a>
      </div>
    </form>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  loading = signal(false);
  error = signal<string | null>(null);

  async submit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.login(email!, password!);
      const returnUrl = this.route.snapshot.queryParamMap.get('return') || '/';
      this.router.navigateByUrl(returnUrl);
    } catch (e: any) {
      this.error.set(e?.error?.message || 'Error al iniciar sesión');
    } finally {
      this.loading.set(false);
    }
  }
}
```

## Anti-patterns Angular específicos

❌ **NO uses `localStorage.setItem('token', ...)`**
   → Solo en signal. Vulnerable XSS.

❌ **NO leas/escribas `document.cookie`**
   → Es HttpOnly, no podés. Browser solo.

❌ **NO inyectes interceptors en NgModule legacy**
   → Usa `withInterceptors([])` con `provideHttpClient`.

❌ **NO bloquees con resolvers que llamen API en cada navegación**
   → Guards cachean state vía signals.

❌ **NO uses constants para URLs**
   → Usa `environment.ts` / `environment.prod.ts`.

❌ **NO ignores `withCredentials: true`**
   → Sin esto, browser no envía cookie cross-origin. Rompe refresh.

❌ **NO uses `subscribe()` sin manejo de unsubscribe**
   → Usa `firstValueFrom`, `toSignal`, `async` pipe, o `takeUntilDestroyed()`.

❌ **NO mezcles forms reactive con template-driven**
   → Mantén reactive en toda la auth (validación robusta).

## Validadores compartidos con backend

```ts
// src/app/shared/validators/password.validator.ts
import { AbstractControl, ValidationErrors } from '@angular/forms';

// Mismo regex que backend (auth.schemas.js password)
export function strongPassword(c: AbstractControl): ValidationErrors | null {
  const v = c.value as string;
  if (!v) return null;
  if (v.length < 8) return { tooShort: true };
  if (!/[A-Z]/.test(v)) return { noUpper: true };
  if (!/[a-z]/.test(v)) return { noLower: true };
  if (!/[0-9]/.test(v)) return { noDigit: true };
  return null;
}

// Phone Bolivia
export function phoneBolivia(c: AbstractControl): ValidationErrors | null {
  const v = c.value as string;
  if (!v) return null;
  return /^\+591[0-9]{8}$/.test(v) ? null : { invalidPhone: true };
}
```

## Estilo UI sugerido

Para mantener brand Gemmatex, usar:
- Color principal: `#0b5ed7` (mismo que emails `MAIL_BRAND_COLOR`)
- Logo: el de los emails `MAIL_LOGO_URL`
- Tipografía: system-ui (rápido) o Inter/Manrope

Tailwind config:
```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0b5ed7',
          dark: '#0a4ec5',
          light: '#eff6ff',
        },
      },
    },
  },
};
```

## Cuando llegue paso 3J (OAuth)

Lo único que cambia en el frontend:
1. Agregar componente `/authorize` que:
   - Lee params query (`client_id`, `redirect_uri`, `state`, `code_challenge`)
   - Si user autenticado → llama backend `/api/v1/auth/authorize` → recibe `code` → redirige a `redirect_uri?code=&state=`
   - Si no autenticado → redirige a `/login?return=/authorize?...`
2. Botón "Salir de todas las apps" en `/sessions`:
   - Llama `POST /api/v1/auth/sso-logout`
3. Tabla en `/sessions` mostrando apps autorizadas

Todo lo demás queda igual. **No habrá rework**.

## Deploy

| Entorno | Sugerencia |
|---|---|
| Dev | `ng serve` localhost:4200 |
| Staging | Vercel/Netlify, branch staging |
| Prod | VPS con nginx + HTTPS (Let's Encrypt) |

Build prod:
```bash
ng build --configuration=production
# dist/account-portal/browser → servir estático
```

## Checklist de implementación

- [ ] Setup Angular + Tailwind + Pinia-equivalente (signals)
- [ ] Variables environment dev/prod
- [ ] AuthService con signals
- [ ] HttpInterceptor con auto-refresh
- [ ] Guards funcionales authGuard/guestGuard/adminGuard
- [ ] Routes con lazy loading
- [ ] Boot recovery en main.ts
- [ ] Layout AuthLayout + AppLayout
- [ ] Componentes shared (FormField, PasswordField)
- [ ] Páginas auth (login, register, forgot, reset, verify, accept-invitation)
- [ ] Páginas account (dashboard, profile, security, sessions)
- [ ] Manejo errores → notificaciones UI
- [ ] Loading states + spinners
- [ ] Accessibility (a11y) — labels, ARIA, focus management
- [ ] Tests unitarios servicios
- [ ] Deploy staging
- [ ] Validar flujo completo con backend SSO
