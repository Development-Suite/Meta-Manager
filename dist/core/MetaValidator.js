"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaValidator = void 0;
const joi_1 = __importDefault(require("joi"));
// Fields injected automatically - never validated from user input
const RESERVED_FIELDS = new Set([
    "uuid",
    "slug",
    "deleted_at",
    "created_at",
    "updated_at",
    "_id",
    "__v",
]);
function stripReserved(map) {
    const out = {};
    for (const key of Object.keys(map)) {
        if (!RESERVED_FIELDS.has(key)) {
            out[key] = map[key];
        }
    }
    return out;
}
function makeUpdateSchema(createMap) {
    const out = {};
    for (const [key, schema] of Object.entries(createMap)) {
        // Strip required() constraint by describing as optional
        out[key] = schema.optional();
    }
    return out;
}
class MetaValidator {
    constructor(options) {
        this.createSchema = null;
        this.updateSchema = null;
        if (options.createSchema) {
            const clean = stripReserved(options.createSchema);
            this.createSchema = joi_1.default.object(clean).options(options.createValidationOptions ?? { abortEarly: false, allowUnknown: true });
            const updateMap = options.updateSchema
                ? stripReserved(options.updateSchema)
                : makeUpdateSchema(clean);
            this.updateSchema = joi_1.default.object(updateMap).options(options.updateValidationOptions ?? { abortEarly: false, allowUnknown: true });
        }
    }
    validate(data, mode) {
        const schema = mode === "create" ? this.createSchema : this.updateSchema;
        if (!schema) {
            return { valid: true, errors: [] };
        }
        const result = schema.validate(data);
        if (!result.error) {
            return { valid: true, errors: [] };
        }
        const errors = result.error.details.map((d) => d.message);
        return { valid: false, errors };
    }
    hasSchema() {
        return this.createSchema !== null;
    }
}
exports.MetaValidator = MetaValidator;
//# sourceMappingURL=MetaValidator.js.map