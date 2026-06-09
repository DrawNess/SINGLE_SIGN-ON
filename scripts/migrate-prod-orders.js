/**
 * migrate-prod-orders.js
 *
 * Genera SQL para migrar las 34 órdenes del API-V6 viejo al schema nuevo
 * (post integración SSO).
 *
 * Schema nuevo orders:
 *   - id (preserva el viejo para mantener referencias en order_status_logs)
 *   - customer_uuid (UUID del SSO, viene del mapping)
 *   - customer_email, customer_first_name, customer_last_name, customer_phone
 *   - customer_document_type, customer_document_number, customer_razon_social
 *   - delivery_departamento, delivery_provincia, delivery_ciudad
 *   - delivery_calle_avenida, delivery_numero, delivery_casa_dpto
 *   - delivery_link_google_maps
 *   - status, detail, contact_name, contact_whatsapp, delivery_whatsapp
 *   - delivery_mode, branch_id, created_at, updated_at
 *
 * Schema nuevo orders_products: igual al viejo (id, order_id, amount, variant_id, unit_price, created_at)
 *
 * Pre-reqs:
 *   - migration-mapping.json con todos los usuarios (incluido old_customer_id)
 *   - DB CATALOGO_GEMMA viva con orders + customers + users + orders_products
 *
 * Uso:
 *   PROD_DB_PASSWORD=xxx PROD_DB_PORT=5432 node scripts/migrate-prod-orders.js > /tmp/orders_migration.sql
 *
 * Para aplicar (DESPUÉS de correr migration 20260525000001-integrate-sso):
 *   sudo -u postgres psql -d CATALOGO_GEMMA -f /tmp/orders_migration.sql
 */

'use strict';

const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const PROD_DB = {
  host:     process.env.PROD_DB_HOST     || 'localhost',
  port:     parseInt(process.env.PROD_DB_PORT, 10) || 5432,
  user:     process.env.PROD_DB_USER     || 'postgres',
  password: process.env.PROD_DB_PASSWORD || '',
  database: process.env.PROD_DB_NAME     || 'CATALOGO_GEMMA',
  ssl:      false,
};

if (!PROD_DB.password) {
  console.error('ERROR: PROD_DB_PASSWORD no seteado.');
  process.exit(1);
}

const MAPPING_FILE = path.join(__dirname, 'migration-mapping.json');

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL';
  return String(v);
}

function sqlInt(v) {
  if (v === null || v === undefined) return 'NULL';
  return String(parseInt(v, 10));
}

async function main() {
  if (!fs.existsSync(MAPPING_FILE)) {
    console.error('ERROR: migration-mapping.json no existe. Corre migrate-prod-users.js primero.');
    process.exit(1);
  }

  const { mapping } = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
  const customerToMap = {};
  for (const m of mapping) {
    if (m.old_customer_id && m.sso_uuid && m.sso_uuid !== 'DRY_RUN') {
      customerToMap[m.old_customer_id] = m;
    }
  }

  const pool = new Pool(PROD_DB);

  const { rows: orders } = await pool.query(`
    SELECT
      o.id, o.customer_id, o.status, o.detail,
      o.created_at, o.updated_at,
      o.contact_name, o.contact_whatsapp, o.delivery_whatsapp,
      o.delivery_mode, o.branch_id,
      c.name AS c_name, c.last_name AS c_last_name, c.phone AS c_phone,
      c.city, c.street, c.street_number, c.apartment,
      u.email
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = c.user_id
    ORDER BY o.id
  `);

  const { rows: items } = await pool.query(`
    SELECT order_id, amount, variant_id, unit_price, created_at
    FROM orders_products
    ORDER BY order_id, id
  `);

  const itemsByOrder = {};
  for (const it of items) {
    if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = [];
    itemsByOrder[it.order_id].push(it);
  }

  const lines = [];
  lines.push('-- Migración orders prod → schema nuevo (post-SSO)');
  lines.push(`-- Generado: ${new Date().toISOString()}`);
  lines.push('-- Pre-req: migration 20260525000001-integrate-sso ya aplicada');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  let migratedOrders = 0;
  let migratedItems  = 0;
  let skippedOrders  = 0;

  for (const o of orders) {
    const m = customerToMap[o.customer_id];

    if (!m) {
      lines.push(`-- SKIP order ${o.id}: customer_id ${o.customer_id} sin mapping`);
      skippedOrders++;
      continue;
    }

    // Map status del viejo al nuevo (asumiendo enums similares)
    const statusMap = {
      'pendiente':  'pendiente',
      'en_proceso': 'en_proceso',
      'entregado':  'entregado',
      'cancelado':  'cancelado',
    };
    const newStatus = statusMap[o.status] || o.status;

    lines.push(`-- Order ${o.id} → user ${m.email} (${m.sso_uuid})`);
    lines.push(`INSERT INTO orders (
  id, customer_uuid, status, detail,
  customer_email, customer_first_name, customer_last_name, customer_phone,
  delivery_ciudad, delivery_calle_avenida, delivery_numero, delivery_casa_dpto,
  contact_name, contact_whatsapp, delivery_whatsapp,
  delivery_mode, branch_id,
  created_at, updated_at
) VALUES (
  ${sqlInt(o.id)},
  ${sqlStr(m.sso_uuid)},
  ${sqlStr(newStatus)},
  ${sqlStr(o.detail)},
  ${sqlStr(o.email)},
  ${sqlStr(m.first_name || o.c_name)},
  ${sqlStr(m.last_name  || o.c_last_name)},
  ${sqlStr(m.phone      || o.c_phone)},
  ${sqlStr(o.city)},
  ${sqlStr(o.street)},
  ${sqlStr(o.street_number)},
  ${sqlStr(o.apartment)},
  ${sqlStr(o.contact_name)},
  ${sqlStr(o.contact_whatsapp)},
  ${sqlStr(o.delivery_whatsapp)},
  ${sqlStr(o.delivery_mode)},
  ${sqlInt(o.branch_id)},
  ${sqlStr(o.created_at.toISOString())},
  ${sqlStr(o.updated_at.toISOString())}
);`);

    // Items de esta orden
    const orderItems = itemsByOrder[o.id] || [];
    for (const it of orderItems) {
      lines.push(`INSERT INTO orders_products (order_id, amount, variant_id, unit_price, created_at)
VALUES (${sqlInt(o.id)}, ${sqlInt(it.amount)}, ${sqlInt(it.variant_id)}, ${sqlNum(it.unit_price)}, ${sqlStr(it.created_at.toISOString())});`);
      migratedItems++;
    }
    lines.push('');
    migratedOrders++;
  }

  // Reajusta secuencia para futuras órdenes
  lines.push("SELECT setval('orders_id_seq', COALESCE((SELECT MAX(id) FROM orders), 0) + 1, false);");
  lines.push("SELECT setval('orders_products_id_seq', COALESCE((SELECT MAX(id) FROM orders_products), 0) + 1, false);");
  lines.push('');
  lines.push('COMMIT;');
  lines.push('');
  lines.push(`-- Resumen: ${migratedOrders} órdenes, ${migratedItems} items, ${skippedOrders} skipped`);

  console.log(lines.join('\n'));
  process.stderr.write(`\nOrders: ${migratedOrders} migradas, ${migratedItems} items, ${skippedOrders} sin mapping\n`);

  await pool.end();
}

main().catch((err) => {
  console.error('Error stack:', err.stack);
  console.error('Error message:', err.message || '(empty)');
  console.error('Error name:', err.name);
  process.exit(1);
});
