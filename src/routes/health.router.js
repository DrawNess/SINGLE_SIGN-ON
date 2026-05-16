'use strict';

const { Router } = require('express');
const { sequelize } = require('../config/db');
const { models } = require('../db/models');
const config = require('../config/env');

const router = Router();

/**
 * GET /health
 * Endpoint público para health checks (load balancer, k8s, monitoring).
 * NO va bajo /api/v1 — es operacional, no versionable.
 */
router.get('/', async (req, res) => {
  try {
    await sequelize.authenticate();
    const counts = {
      users: await models.User.count(),
      roles: await models.Role.count(),
      applications: await models.Application.count(),
    };
    res.json({
      status: 'ok',
      service: config.app.name,
      env: config.env,
      db: 'connected',
      counts,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      service: config.app.name,
      db: 'disconnected',
      error: err.message,
    });
  }
});

module.exports = router;
