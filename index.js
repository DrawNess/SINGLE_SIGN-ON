'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const config = require('./src/config/env');
const { sequelize, connect, disconnect } = require('./src/config/db');
const { models } = require('./src/db/models');

const authRoutes = require('./src/routes/auth.routes');
const wellKnownRoutes = require('./src/routes/well-known.routes');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');

const app = express();

// Trust proxy si está detrás de nginx/load balancer (afecta req.ip)
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

if (config.cors.origins.length > 0) {
  app.use(
    cors({
      origin: config.cors.origins,
      credentials: true,
      exposedHeaders: ['Content-Length'],
    })
  );
}

// Health check
app.get('/health', async (req, res) => {
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

// Rutas
app.use('/.well-known', wellKnownRoutes);
app.use('/auth', authRoutes);

// 404 + error handler (siempre al final)
app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    await connect();
    app.listen(config.app.port, () => {
      console.log('');
      console.log(`✔ ${config.app.name} (${config.env})`);
      console.log(`✔ Servidor en ${config.app.url}`);
      console.log(`✔ Health: ${config.app.url}/health`);
      console.log(`✔ JWKS:   ${config.app.url}/.well-known/jwks.json`);
      console.log('');
    });
  } catch (err) {
    console.error('✖ Fallo al arrancar:', err.message);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`\n[${signal}] cerrando...`);
  try {
    await disconnect();
  } catch (err) {
    console.error('Error cerrando DB:', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
