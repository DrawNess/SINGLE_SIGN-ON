'use strict';

const cron = require('node-cron');
const config = require('../config/env');
const { cleanupTokens } = require('./cleanup-tokens.job');

const scheduled = [];

/**
 * Registra todos los cron jobs.
 * Llamado desde index.js raíz tras conectar DB.
 */
function startJobs() {
  if (!config.jobs.enabled) {
    console.log('[jobs] deshabilitados via JOBS_ENABLED=false');
    return;
  }

  // 1. Cleanup tokens (daily)
  const cleanupTask = cron.schedule(
    config.jobs.cleanupTokensCron,
    async () => {
      console.log('[job:cleanup] arrancando...');
      try {
        await cleanupTokens();
      } catch (err) {
        console.error('[job:cleanup] excepción:', err);
      }
    },
    { timezone: 'America/La_Paz' }
  );
  scheduled.push({ name: 'cleanup-tokens', task: cleanupTask, schedule: config.jobs.cleanupTokensCron });

  console.log(`[jobs] ${scheduled.length} jobs registrados:`);
  scheduled.forEach((j) => console.log(`  - ${j.name}: ${j.schedule}`));
}

/**
 * Detiene todos los jobs (para graceful shutdown).
 */
function stopJobs() {
  scheduled.forEach((j) => {
    try {
      j.task.stop();
    } catch {}
  });
  console.log('[jobs] todos detenidos');
}

module.exports = { startJobs, stopJobs, cleanupTokens };
