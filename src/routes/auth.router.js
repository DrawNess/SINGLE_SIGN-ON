'use strict';

const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
} = require('../middleware/rateLimit');
const schemas = require('../schemas/auth.schemas');
const adminSchemas = require('../schemas/admin.schemas');

const router = Router();

router.post('/register',
  registerLimiter,
  validate({ body: schemas.register }),
  controller.register
);

router.post('/login',
  loginLimiter,
  validate({ body: schemas.login }),
  controller.login
);

router.post('/refresh',
  validate({ body: schemas.refresh }),
  controller.refresh
);

router.post('/logout',
  requireAuth(),
  validate({ body: schemas.logout }),
  controller.logout
);

router.get('/me', requireAuth(), controller.me);

// Editar mi propio profile (client o admin auto-detect)
router.patch('/me',
  requireAuth(),
  validate({ body: schemas.updateMyProfile }),
  controller.updateMe
);

// Mis sesiones activas
router.get('/sessions', requireAuth(), controller.listMySessions);

// Revoca una sesión propia (force-logout dispositivo)
router.delete('/sessions/:id',
  requireAuth(),
  validate({ params: schemas.sessionIdParam }),
  controller.revokeMySession
);

// Revocar todas menos la actual
router.post('/sessions/logout-others', requireAuth(), controller.logoutOthers);

// Verificación de email (registro o cambio de email)
router.get('/verify-email',
  validate({ query: schemas.verifyEmailQuery }),
  controller.verifyEmail
);
router.post('/verify-email',
  validate({ body: schemas.verifyEmailBody }),
  controller.verifyEmail
);

// Alias para link del email de cambio de correo
router.get('/confirm-email-change',
  validate({ query: schemas.verifyEmailQuery }),
  controller.verifyEmail
);

// Reenviar email de verificación
router.post('/resend-verification',
  validate({ body: schemas.resendVerification }),
  controller.resendVerification
);

// Iniciar cambio de email (autenticado, envía email al NUEVO destino)
router.post('/change-email',
  requireAuth(),
  validate({ body: schemas.changeEmail }),
  controller.changeEmail
);

// Olvidé mi contraseña → envía email con link de reset
router.post('/forgot-password',
  forgotPasswordLimiter,
  validate({ body: schemas.forgotPassword }),
  controller.forgotPassword
);

// Reset password con token del email
router.post('/reset-password',
  validate({ body: schemas.resetPassword }),
  controller.resetPassword
);

// Cambiar password autenticado (sabe la actual)
router.post('/change-password',
  requireAuth(),
  validate({ body: schemas.changePassword }),
  controller.changePassword
);

// Aceptar invitación admin/staff (público, token autentica)
router.post('/accept-invitation',
  validate({ body: adminSchemas.acceptInvitation }),
  controller.acceptInvitation
);

module.exports = router;
