'use strict';

const { Router } = require('express');

const authRouter = require('./auth.router');
const adminRouter = require('./admin.router');
const wellKnownRouter = require('./well-known.router');
const healthRouter = require('./health.router');


function routerApi(app) {
  // --- Rutas no versionadas ---
  app.use('/health', healthRouter);
  app.use('/.well-known', wellKnownRouter);

  // --- Rutas versionadas ---

  const apiRouter = Router();
  app.use('/api/v1', apiRouter);

  apiRouter.use('/auth', authRouter);
  apiRouter.use('/admin', adminRouter);


  // TODO próximas iteraciones:
  // apiRouter.use('/internal', internalRouter);
}

module.exports = { routerApi };
