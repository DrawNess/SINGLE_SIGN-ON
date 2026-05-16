'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const config = require('./src/config/env');
const { connect, disconnect } = require('./src/config/db');
require('./src/db/models'); // carga modelos + asociaciones

const { routerApi } = require('./src/routes');
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

// Rutas (versionadas + no versionadas)
routerApi(app);

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
      console.log(`✔ API:     ${config.app.url}/api/v1`);
      console.log(`✔ Health:  ${config.app.url}/health`);
      console.log(`✔ JWKS:    ${config.app.url}/.well-known/jwks.json`);
      console.log('');
    });
  } catch (err) {
    console.error('Fallo al arrancar:', err.message);
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
