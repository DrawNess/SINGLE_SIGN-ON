'use strict';

/**
 * Middleware factory que valida `req.body` / `req.query` / `req.params`
 * contra un schema Joi. Si falla → 400 con todos los detalles.
 *
 * Uso:
 *   router.post('/login', validate({ body: schemas.login }), controller.login);
 */
module.exports = function validate(schemas) {
  return (req, res, next) => {
    const errors = [];

    for (const target of ['body', 'query', 'params']) {
      const schema = schemas[target];
      if (!schema) continue;
      const { value, error } = schema.validate(req[target], {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });
      if (error) {
        errors.push(
          ...error.details.map((d) => ({
            in: target,
            path: d.path.join('.'),
            message: d.message,
          }))
        );
      } else if (target === 'query') {
        // Express 5: req.query es getter readonly → usar defineProperty
        Object.defineProperty(req, 'query', {
          value,
          writable: true,
          configurable: true,
        });
      } else {
        req[target] = value;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Datos de entrada inválidos',
        details: errors,
      });
    }

    next();
  };
};
