import Joi from "joi";
import { JoiSchemaMap, MetaEntityOptions, ValidationResult } from "../types";

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

function stripReserved(map: JoiSchemaMap): JoiSchemaMap {
  const out: JoiSchemaMap = {};
  for (const key of Object.keys(map)) {
    if (!RESERVED_FIELDS.has(key)) {
      out[key] = map[key];
    }
  }
  return out;
}

function makeUpdateSchema(createMap: JoiSchemaMap): JoiSchemaMap {
  const out: JoiSchemaMap = {};
  for (const [key, schema] of Object.entries(createMap)) {
    // Strip required() constraint by describing as optional
    out[key] = (schema as any).optional();
  }
  return out;
}

export class MetaValidator {
  private createSchema: Joi.ObjectSchema | null = null;
  private updateSchema: Joi.ObjectSchema | null = null;

  constructor(options: MetaEntityOptions) {
    if (options.createSchema) {
      const clean = stripReserved(options.createSchema);
      this.createSchema = Joi.object(clean).options(
        options.createValidationOptions ?? { abortEarly: false, allowUnknown: true }
      );

      const updateMap = options.updateSchema
        ? stripReserved(options.updateSchema)
        : makeUpdateSchema(clean);

      this.updateSchema = Joi.object(updateMap).options(
        options.updateValidationOptions ?? { abortEarly: false, allowUnknown: true }
      );
    }
  }

  validate(data: unknown, mode: "create" | "update"): ValidationResult {
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

  hasSchema(): boolean {
    return this.createSchema !== null;
  }
}
