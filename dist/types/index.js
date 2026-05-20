"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveIntendedFields = resolveIntendedFields;
/**
 * Resolves the intended field paths from a request for field-targeted
 * interceptor matching.
 *
 * Sources per route type:
 *   PUT/PATCH /:id              -> keys of req.body
 *   PATCH /:id/field/:field     -> req.params.field
 *   PATCH /:id/nested           -> req.body.field
 *   PATCH /:id/nested/batch     -> req.body[].field (each op)
 */
function resolveIntendedFields(req) {
    // PATCH /:id/field/:fieldName
    if (req.params && req.params.field && !req.body?.operation) {
        return [req.params.field];
    }
    // PATCH /:id/nested/batch - array body or { ops: [] }
    const ops = Array.isArray(req.body) ? req.body : req.body?.ops;
    if (Array.isArray(ops)) {
        return ops.map((op) => op?.field).filter(Boolean);
    }
    // PATCH /:id/nested - { field, operation, value }
    if (req.body?.field && req.body?.operation) {
        return [req.body.field];
    }
    // PUT/PATCH /:id - body keys are the intended fields
    return Object.keys(req.body || {});
}
//# sourceMappingURL=index.js.map