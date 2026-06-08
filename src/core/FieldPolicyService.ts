import { FieldPolicyMap } from "../types/features";
import { CustomRequest } from "../types";

export class FieldPolicyService {
  constructor(private readonly policy: FieldPolicyMap) {}

  /**
   * Evaluate all read policies against the request and return a set of
   * field names that should be stripped from the response.
   */
  async getStrippedReadFields(req: CustomRequest): Promise<Set<string>> {
    const stripped = new Set<string>();
    for (const [field, rules] of Object.entries(this.policy)) {
      if (!rules.read) continue;
      try {
        const allowed = await Promise.resolve(rules.read(req));
        if (!allowed) stripped.add(field);
      } catch {
        stripped.add(field);
      }
    }
    return stripped;
  }

  /**
   * Strip denied read fields from a single document.
   */
  async applyReadPolicy(
    doc: Record<string, unknown>,
    req: CustomRequest
  ): Promise<Record<string, unknown>> {
    const stripped = await this.getStrippedReadFields(req);
    if (stripped.size === 0) return doc;
    const result = { ...doc };
    for (const field of stripped) {
      delete result[field];
    }
    return result;
  }

  /**
   * Strip denied read fields from a list of documents.
   * Evaluates policies once and applies the result set to all items.
   */
  async applyReadPolicyToMany(
    docs: Record<string, unknown>[],
    req: CustomRequest
  ): Promise<Record<string, unknown>[]> {
    const stripped = await this.getStrippedReadFields(req);
    if (stripped.size === 0) return docs;
    return docs.map((doc) => {
      const result = { ...doc };
      for (const field of stripped) delete result[field];
      return result;
    });
  }

  /**
   * Evaluate write policies and remove or reject denied fields from a payload.
   * Returns the sanitised payload. Throws 403 if strict:true on a denied field.
   */
  async applyWritePolicy(
    data: Record<string, unknown>,
    req: CustomRequest
  ): Promise<Record<string, unknown>> {
    const result = { ...data };

    for (const [field, rules] of Object.entries(this.policy)) {
      if (!rules.write) continue;
      if (!(field in result)) continue;

      let allowed: boolean;
      try {
        allowed = await Promise.resolve(rules.write(req));
      } catch {
        allowed = false;
      }

      if (!allowed) {
        if (rules.strict) {
          const err = new Error(`Write access to field "${field}" is denied.`) as any;
          err.status = 403;
          err.isFieldPolicy = true;
          throw err;
        }
        delete result[field];
      }
    }

    return result;
  }

  hasPolicy(): boolean {
    return Object.keys(this.policy).length > 0;
  }
}
