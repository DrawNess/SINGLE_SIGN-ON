/**
 * migrate-prod-orders.js
 *
 * Genera SQL de INSERT para las 33 órdenes del prod antiguo,
 * adaptadas al nuevo schema del API-V6 integrado con SSO.
 *
 * Prerequisitos:
 *   1. Haber corrido migrate-prod-users.js → migration-mapping.json generado
 *   2. Tunnel SSH activo: ssh -L 5433:localhost:5432 root@<VPS_IP> -N &
 *
 * Uso:
 *   node scripts/migrate-prod-orders.js > /tmp/orders_migration.sql
 *   # Revisar el SQL, luego ejecutar en la nueva DB del API-V6:
 *   # psql -h localhost -p 5434 -U postgres -d gemma_catalogo -f /tmp/orders_migration.sql
 */

'use strict';

const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

const PROD_DB = {
  host:     process.env.PROD_DB_HOST     || 'localhost',
  port:     parseInt(process.env.PROD_DB_PORT, 10) || 5433,
  user:     process.env.PROD_DB_USER     || 'postgres',
  password: process.env.PROD_DB_PASSWORD || '',
  database: process.env.PROD_DB_NAME     || 'CATALOGO_GEMMA',
  ssl:      false,
};

if (!PROD_DB.password) {
  console.error('ERROR: PROD_DB_PASSWORD no seteado. Exportar antes de correr.');
  process.exit(1);
}

const MAPPING_FILE = path.join(__dirname, 'migration-mapping.json');

async function main() {
  if (!fs.existsSync(MAPPING_FILE)) {
    console.error('ERROR: migration-mapping.json no existe. Corre primero migrate-prod-users.js');
    process.exit(1);
  }

  const { mapping } = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
  const customerToUuid = {};
  for (const m of mapping) {
    if (m.old_customer_id && m.sso_uuid && m.sso_uuid !== 'DRY_RUN') {
      customerToUuid[m.old_customer_id] = { uuid: m.sso_uuid, ...m };
    }
  }

  const pool = new Pool(PROD_DB);

  // Leer órdenes + productos
  const { rows: orders } = await pool.query(`
    SELECT
      o.id            AS order_id,
      o.customer_id,
      o.status,
      o.created_at,
      o.updated_at,
      o.contact_name,
      o.contact_whatsapp,
      o.delivery_whatsapp,
      o.delivery_mode,
      o.branch_id,
      o.detail        AS observations,
      c.name          AS cust_name,
      c.last_name     AS cust_last_name,
      c.phone         AS cust_phone,
      c.city,
      c.street,
      c.street_number,
      c.apartment,
      u.email
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = c.user_id
    ORDER BY o.id
  `);

  const { rows: orderProducts } = await pool.query(`
    SELECT
      op.order_id,
      v.product_id,
      op.variant_id,
      op.amount      AS quantity,
      op.unit_price,
      p.name         AS product_name,
      v.sku
    FROM orders_products op
    LEFT JOIN variants v ON v.id = op.variant_id
    LEFT JOIN products p ON p.id = v.product_id
    ORDER BY op.order_id
  `);

  const productsByOrder = {};
  for (const op of orderProducts) {
    if (!productsByOrder[op.order_id]) productsByOrder[op.order_id] = [];
    productsByOrder[op.order_id].push(op);
  }

  // Generar SQL
  const lines = [];
  lines.push('-- Migración órdenes prod → nuevo API-V6 + SSO');
  lines.push(`-- Generado: ${new Date().toISOString()}`);
  lines.push('-- REVISAR antes de ejecutar.\n');
  lines.push('BEGIN;\n');

  let migrated = 0, skipped = 0;

  for (const o of orders) {
    const mapped = customerToUuid[o.customer_id];

    if (!mapped) {
      lines.push(`-- SKIP order ${o.order_id}: customer_id ${o.customer_id} sin UUID en mapping`);
      skipped++;
      continue;
    }

    const products = productsByOrder[o.order_id] || [];

    // Snapshot del cliente
    const snapshot = JSON.stringify({
      user_id:    mapped.uuid,
      email:      o.email,
      first_name: o.cust_name      || '',
      last_name:  o.cust_last_name || '',
      phone:      o.cust_phone     || '',
      address: {
        city:          o.city          || '',
        street:        o.street        || '',
        street_number: o.street_number || '',
        apartment:     o.apartment     || '',
      },
    }).replace(/'/g, "''");

    // Snapshot de productos
    const productsSnapshot = JSON.stringify(
      products.map(p => ({
        product_id:   p.product_id,
        variant_id:   p.variant_id,
        sku:          p.sku,
        name:         p.product_name,
        quantity:     p.quantity,
        unit_price:   p.unit_price ?? 0,
      }))
    ).replace(/'/g, "''");

    // Map status del viejo al nuevo
    const statusMap = {
      'pendiente': 'pending',
      'en_proceso': 'confirmed',
      'entregado': 'delivered',
      'cancelado': 'cancelled',
    };
    const newStatus = statusMap[o.status] || o.status;

    // INSERT en nuevo schema (ajustar columnas según tu nuevo orders table)
    lines.push(`-- Order ${o.order_id} → user ${mapped.email}`);
    lines.push(`INSERT INTO orders (
  user_id, status, customer_snapshot, items_snapshot,
  delivery_mode, branch_id, contact_name, contact_whatsapp,
  observations, created_at, updated_at
) VALUES (
  '${mapped.uuid}',
  '${newStatus}',
  '${snapshot}'::jsonb,
  '${productsSnapshot}'::jsonb,
  ${o.delivery_mode ? `'${o.delivery_mode}'` : 'NULL'},
  ${o.branch_id     ? `${o.branch_id}`       : 'NULL'},
  ${o.contact_name  ? `'${o.contact_name.replace(/'/g,"''")}'` : 'NULL'},
  ${o.contact_whatsapp ? `'${o.contact_whatsapp}'` : 'NULL'},
  ${o.observations  ? `'${o.observations.replace(/'/g,"''")}'` : 'NULL'},
  '${o.created_at.toISOString()}',
  '${o.updated_at.toISOString()}'
) ON CONFLICT DO NOTHING;\n`);

    migrated++;
  }

  lines.push('COMMIT;\n');
  lines.push(`-- Resumen: ${migrated} migradas, ${skipped} sin mapping`);

  console.log(lines.join('\n'));
  process.stderr.write(`\nÓrdenes: ${migrated} migradas, ${skipped} sin mapping\n`);

  await pool.end();
}

main().catch(err => {
  console.error('Error stack:', err.stack);
  console.error('Error message:', err.message || '(empty)');
  console.error('Error name:', err.name);
  process.exit(1);
});
