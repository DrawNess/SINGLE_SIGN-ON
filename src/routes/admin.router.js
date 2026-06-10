'use strict';

const { Router } = require('express');
const controller = require('../controllers/admin.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const schemas = require('../schemas/admin.schemas');

const router = Router();

// Todos los endpoints admin requieren autenticación + rol admin/super_admin
router.use(requireAuth(), requireRole('admin', 'super_admin'));

// --- Stats ---
router.get('/stats',
  validate({ query: schemas.statsQuery }),
  controller.getStats
);

// --- Users ---
router.get('/users',
  validate({ query: schemas.listUsers }),
  controller.listUsers
);
router.get('/users/:id',
  validate({ params: schemas.userIdParam }),
  controller.getUser
);
router.patch('/users/:id',
  validate({ params: schemas.userIdParam, body: schemas.updateUser }),
  controller.updateUser
);
router.delete('/users/:id',
  validate({ params: schemas.userIdParam }),
  controller.deleteUser
);
router.post('/users/:id/restore',
  validate({ params: schemas.userIdParam }),
  controller.restoreUser
);

// --- Sessions de un user ---
router.get('/users/:userId/sessions',
  validate({ params: schemas.userIdParamSessions, query: schemas.listSessions }),
  controller.listUserSessions
);
router.delete('/users/:userId/sessions',
  validate({ params: schemas.userIdParamSessions }),
  controller.revokeAllUserSessions
);
router.delete('/sessions/:id',
  validate({ params: schemas.sessionIdParam }),
  controller.revokeSession
);

// --- Audit logs ---
router.get('/audit-logs',
  validate({ query: schemas.listAuditLogs }),
  controller.listAuditLogs
);

// --- Applications ---
router.get('/applications',
  validate({ query: schemas.listApplications }),
  controller.listApplications
);
router.post('/applications',
  validate({ body: schemas.createApplication }),
  controller.createApplication
);
router.get('/applications/:id',
  validate({ params: schemas.appIdParam }),
  controller.getApplication
);
router.patch('/applications/:id',
  validate({ params: schemas.appIdParam, body: schemas.updateApplication }),
  controller.updateApplication
);
router.delete('/applications/:id',
  validate({ params: schemas.appIdParam }),
  controller.deleteApplication
);
router.post('/applications/:id/rotate-secret',
  validate({ params: schemas.appIdParam }),
  controller.rotateClientSecret
);

// --- API keys (por application) ---
router.get('/applications/:appId/api-keys',
  validate({ params: schemas.appIdAndQuery, query: schemas.listApiKeys }),
  controller.listApiKeys
);
router.post('/applications/:appId/api-keys',
  validate({ params: schemas.appIdAndQuery, body: schemas.createApiKey }),
  controller.createApiKey
);
router.delete('/api-keys/:id',
  validate({ params: schemas.apiKeyIdParam }),
  controller.revokeApiKey
);

// --- Invitations ---
router.get('/invitations',
  validate({ query: schemas.listInvitations }),
  controller.listInvitations
);
router.post('/invitations',
  validate({ body: schemas.createInvitation }),
  controller.createInvitation
);
router.delete('/invitations/:id',
  validate({ params: schemas.invitationIdParam }),
  controller.revokeInvitation
);

module.exports = router;
