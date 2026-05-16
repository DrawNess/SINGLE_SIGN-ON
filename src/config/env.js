// Carga y valida variables de entorno con Joi.
// Falla rápido al boot si falta algo crítico → evita errores en runtime.
require('dotenv').config();

const Joi = require('joi');
const fs = require('node:fs');
const path = require('node:path');

const schema = Joi.object({
  // App
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(2106),
  APP_NAME: Joi.string().default('sso-gemmatex'),
  APP_URL: Joi.string().uri().required(),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),

  // DB
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
  DB_POOL_MAX: Joi.number().integer().min(1).default(10),
  DB_POOL_MIN: Joi.number().integer().min(0).default(0),
  DB_POOL_IDLE: Joi.number().integer().min(0).default(10000),

  // JWT
  JWT_PRIVATE_KEY_PATH: Joi.string().required(),
  JWT_PUBLIC_KEY_PATH: Joi.string().required(),
  JWT_ISSUER: Joi.string().required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: Joi.number().integer().min(1).max(365).default(7),
  JWT_KID: Joi.string().required(),

  // Cifrado simétrico (AES-256-GCM) — 32 bytes hex
  ENCRYPTION_KEY: Joi.string().hex().length(64).required(),

  // Mail SMTP
  MAIL_HOST: Joi.string().required(),
  MAIL_PORT: Joi.number().port().default(465),
  MAIL_SECURE: Joi.boolean().truthy('true').falsy('false').default(true),
  MAIL_USER: Joi.string().required(),
  MAIL_PASSWORD: Joi.string().required(),
  MAIL_FROM_NAME: Joi.string().default('GEMMATEX SSO'),
  MAIL_FROM_EMAIL: Joi.string().email().required(),

  // URLs para links de email — deben contener {token}
  EMAIL_VERIFY_URL_TEMPLATE: Joi.string()
    .pattern(/\{token\}/)
    .default('http://localhost:2106/api/v1/auth/verify-email?token={token}'),
  EMAIL_CHANGE_URL_TEMPLATE: Joi.string()
    .pattern(/\{token\}/)
    .default('http://localhost:2106/api/v1/auth/confirm-email-change?token={token}'),
  EMAIL_RESET_URL_TEMPLATE: Joi.string()
    .pattern(/\{token\}/)
    .default('http://localhost:2106/api/v1/auth/reset-password?token={token}'),

  // SMS
  SMS_PROVIDER: Joi.string().valid('twilio', 'mock').default('mock'),
  SMS_FROM: Joi.string().default(''),
  TWILIO_ACCOUNT_SID: Joi.string().allow('').default(''),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').default(''),

  // Seguridad
  PASSWORD_HISTORY_SIZE: Joi.number().integer().min(0).default(5),
  LOGIN_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  LOGIN_LOCKOUT_MINUTES: Joi.number().integer().min(1).default(15),
  EMAIL_VERIFY_TTL_HOURS: Joi.number().integer().min(1).default(24),
  PHONE_VERIFY_TTL_MINUTES: Joi.number().integer().min(1).default(10),
  PHONE_VERIFY_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  PASSWORD_RESET_TTL_HOURS: Joi.number().integer().min(1).default(1),
  ADMIN_INVITE_TTL_DAYS: Joi.number().integer().min(1).default(7),

  // Rate limit
  RATE_LIMIT_LOGIN_PER_MIN: Joi.number().integer().min(1).default(5),
  RATE_LIMIT_FORGOT_PER_HOUR: Joi.number().integer().min(1).default(3),
  RATE_LIMIT_REGISTER_PER_HOUR: Joi.number().integer().min(1).default(10),

  // CORS
  CORS_ORIGINS: Joi.string().default(''),
}).unknown(true);

const { value, error } = schema.validate(process.env, {
  abortEarly: false,
  stripUnknown: false,
});

if (error) {
  console.error('✖ Variables de entorno inválidas:');
  error.details.forEach((d) => console.error(`  - ${d.message}`));
  process.exit(1);
}

// Cargar claves JWT desde disco (fallar si no existen)
function loadKey(relPath, label) {
  const abs = path.resolve(relPath);
  if (!fs.existsSync(abs)) {
    console.error(`✖ ${label} no encontrada en ${abs}`);
    console.error('  Ejecuta: npm run keys:generate');
    process.exit(1);
  }
  return fs.readFileSync(abs, 'utf8');
}

const jwtPrivateKey = loadKey(value.JWT_PRIVATE_KEY_PATH, 'Clave privada JWT');
const jwtPublicKey = loadKey(value.JWT_PUBLIC_KEY_PATH, 'Clave pública JWT');

module.exports = {
  env: value.NODE_ENV,
  isProd: value.NODE_ENV === 'production',
  isDev: value.NODE_ENV === 'development',
  isTest: value.NODE_ENV === 'test',

  app: {
    name: value.APP_NAME,
    port: value.PORT,
    url: value.APP_URL,
    logLevel: value.LOG_LEVEL,
  },

  db: {
    host: value.DB_HOST,
    port: value.DB_PORT,
    user: value.DB_USER,
    password: value.DB_PASSWORD,
    name: value.DB_NAME,
    pool: {
      max: value.DB_POOL_MAX,
      min: value.DB_POOL_MIN,
      idle: value.DB_POOL_IDLE,
    },
  },

  jwt: {
    privateKey: jwtPrivateKey,
    publicKey: jwtPublicKey,
    issuer: value.JWT_ISSUER,
    accessTtl: value.JWT_ACCESS_TTL,
    refreshTtlDays: value.JWT_REFRESH_TTL_DAYS,
    kid: value.JWT_KID,
    algorithm: 'RS256',
  },

  encryption: {
    keyHex: value.ENCRYPTION_KEY,
  },

  mail: {
    host: value.MAIL_HOST,
    port: value.MAIL_PORT,
    secure: value.MAIL_SECURE,
    user: value.MAIL_USER,
    password: value.MAIL_PASSWORD,
    fromName: value.MAIL_FROM_NAME,
    fromEmail: value.MAIL_FROM_EMAIL,
    verifyUrlTemplate: value.EMAIL_VERIFY_URL_TEMPLATE,
    changeUrlTemplate: value.EMAIL_CHANGE_URL_TEMPLATE,
    resetUrlTemplate: value.EMAIL_RESET_URL_TEMPLATE,
  },

  sms: {
    provider: value.SMS_PROVIDER,
    from: value.SMS_FROM,
    twilio: {
      accountSid: value.TWILIO_ACCOUNT_SID,
      authToken: value.TWILIO_AUTH_TOKEN,
    },
  },

  security: {
    passwordHistorySize: value.PASSWORD_HISTORY_SIZE,
    loginMaxAttempts: value.LOGIN_MAX_ATTEMPTS,
    loginLockoutMinutes: value.LOGIN_LOCKOUT_MINUTES,
    emailVerifyTtlHours: value.EMAIL_VERIFY_TTL_HOURS,
    phoneVerifyTtlMinutes: value.PHONE_VERIFY_TTL_MINUTES,
    phoneVerifyMaxAttempts: value.PHONE_VERIFY_MAX_ATTEMPTS,
    passwordResetTtlHours: value.PASSWORD_RESET_TTL_HOURS,
    adminInviteTtlDays: value.ADMIN_INVITE_TTL_DAYS,
  },

  rateLimit: {
    loginPerMin: value.RATE_LIMIT_LOGIN_PER_MIN,
    forgotPerHour: value.RATE_LIMIT_FORGOT_PER_HOUR,
    registerPerHour: value.RATE_LIMIT_REGISTER_PER_HOUR,
  },

  cors: {
    origins: value.CORS_ORIGINS
      ? value.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
  },
};
