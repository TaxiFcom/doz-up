'use strict';

/**
 * validate.js — Zod Input Validation Middleware
 *
 * Provides a factory function that returns an Express middleware validating
 * req[target] against a Zod schema.  Returns 422 Unprocessable Entity with
 * field-level error detail on failure.
 *
 * Supports targets: 'body' | 'params' | 'query'
 *
 * Usage in gateway.js:
 *
 *   const { z } = require('zod');
 *   const { validate } = require('./src/middleware/validate');
 *
 *   const CreateUserSchema = z.object({
 *     email:    z.string().email(),
 *     password: z.string().min(8),
 *     role:     z.enum(['admin', 'user']).optional(),
 *   });
 *
 *   app.post('/api/users',
 *     validate(CreateUserSchema),          // validates req.body (default)
 *     asyncWrap(async (req, res) => { ... })
 *   );
 *
 *   // Validate route params:
 *   app.get('/api/users/:id',
 *     validate(z.object({ id: z.string().uuid() }), 'params'),
 *     handler
 *   );
 *
 *   // Validate query string:
 *   app.get('/api/screenshots',
 *     validate(z.object({ page: z.coerce.number().int().min(1).optional() }), 'query'),
 *     handler
 *   );
 */

const { z } = require('zod');

/**
 * validate(schema, target?)
 *
 * @param {import('zod').ZodTypeAny} schema  — Zod schema to validate against
 * @param {'body'|'params'|'query'}  target  — which part of the request to validate (default: 'body')
 * @returns {import('express').RequestHandler}
 */
function validate(schema, target = 'body') {
    if (!['body', 'params', 'query'].includes(target)) {
        throw new Error(`validate(): unsupported target "${target}". Use 'body', 'params', or 'query'.`);
    }

    return function validationMiddleware(req, res, next) {
        const result = schema.safeParse(req[target]);

        if (result.success) {
            // Replace the original input with the parsed (coerced/transformed) value
            req[target] = result.data;
            return next();
        }

        // Format Zod errors into a flat, human-readable field map
        const fieldErrors = result.error.errors.reduce((acc, issue) => {
            // issue.path is an array like ['email'] or ['address', 'city']
            const field = issue.path.length > 0 ? issue.path.join('.') : '_root';
            if (!acc[field]) {
                acc[field] = issue.message;
            }
            return acc;
        }, {});

        return res.status(422).json({
            error:  'Validation failed',
            code:   'VALIDATION_ERROR',
            target,
            fields: fieldErrors,
        });
    };
}

/**
 * validateBody(schema) — shorthand for validate(schema, 'body')
 */
function validateBody(schema) {
    return validate(schema, 'body');
}

/**
 * validateParams(schema) — shorthand for validate(schema, 'params')
 */
function validateParams(schema) {
    return validate(schema, 'params');
}

/**
 * validateQuery(schema) — shorthand for validate(schema, 'query')
 */
function validateQuery(schema) {
    return validate(schema, 'query');
}

module.exports = { validate, validateBody, validateParams, validateQuery };
