'use strict';

const { Router } = require('express');
const { getJwks } = require('../utils/jwks');

const router = Router();

/**
 * JWKS endpoint público. Otros microservicios (Tickets, E-commerce, CRM)
 * descargan esta clave una vez, la cachean y validan JWT localmente.
 *
 * Cache-Control: pueden cachear 1 hora — al rotar key, devolver ambas
 * en el array `keys` y aumentar `Cache-Control` después de propagación.
 */
router.get('/jwks.json', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(getJwks());
});

module.exports = router;
