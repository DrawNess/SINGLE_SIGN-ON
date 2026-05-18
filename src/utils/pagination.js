'use strict';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Extrae page y page_size de req.query, con defaults sanos.
 * Calcula offset para Sequelize `findAndCountAll`.
 */
function parsePagination(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(query.page_size) || DEFAULT_PAGE_SIZE)
  );
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
}

/**
 * Envoltorio estándar para respuesta paginada.
 * `rows` y `count` vienen de `Model.findAndCountAll`.
 */
function paginatedResponse({ rows, count, page, pageSize, mapper = (r) => r }) {
  return {
    items: rows.map(mapper),
    pagination: {
      page,
      page_size: pageSize,
      total: count,
      total_pages: Math.max(1, Math.ceil(count / pageSize)),
    },
  };
}

module.exports = { parsePagination, paginatedResponse, MAX_PAGE_SIZE };
