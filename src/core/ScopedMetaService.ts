import {
  BaseEntityDocument,
  IMetaService,
  QueryOptions,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  PaginatedResult,
  CustomRequest,
} from "../types";
import { ScopedServiceOptions } from "../types/features";
import { FieldPolicyService } from "./FieldPolicyService";
import { ValidationResult } from "../types";

/**
 * A request-scoped service wrapper.
 * - Automatically fills created_by, updated_by, added_by from req.user.
 * - Enforces field-level write policies using the request context before data reaches the DB.
 * - Enforces field-level read policies on returned documents.
 */
export class ScopedMetaService<T extends BaseEntityDocument = BaseEntityDocument>
  implements IMetaService<T>
{
  private readonly callerId: string | undefined;

  constructor(
    private readonly base: IMetaService<T>,
    private readonly req: CustomRequest,
    private readonly fieldPolicy: FieldPolicyService | null,
    private readonly opts: ScopedServiceOptions
  ) {
    this.callerId = this.resolveCallerId();
  }

  private resolveCallerId(): string | undefined {
    const userField = this.opts.userField ?? "user";
    const idField   = this.opts.userIdField ?? "uuid";
    const user      = (this.req as any)[userField];
    if (!user) return undefined;
    return (
      user[idField] ??
      user["uuid"] ??
      user["id"] ??
      user["_id"] ??
      undefined
    );
  }

  private injectIdentity(data: Partial<T>): Partial<T> {
    if (!this.callerId) return data;
    const enriched = { ...data } as any;
    if (!enriched.created_by) enriched.created_by = this.callerId;
    if (!enriched.added_by)   enriched.added_by   = this.callerId;
    enriched.updated_by = this.callerId;
    return enriched as Partial<T>;
  }

  private async guardWrite(data: Partial<T>): Promise<Partial<T>> {
    if (!this.fieldPolicy?.hasPolicy()) return data;
    const sanitised = await this.fieldPolicy.applyWritePolicy(
      data as Record<string, unknown>,
      this.req
    );
    return sanitised as Partial<T>;
  }

  private async applyReadPolicy(doc: T | null): Promise<T | null> {
    if (!doc || !this.fieldPolicy?.hasPolicy()) return doc;
    const stripped = await this.fieldPolicy.applyReadPolicy(
      doc as unknown as Record<string, unknown>,
      this.req
    );
    return stripped as unknown as T;
  }

  private async applyReadPolicyToResult(
    result: PaginatedResult<T>
  ): Promise<PaginatedResult<T>> {
    if (!this.fieldPolicy?.hasPolicy()) return result;
    const stripped = await this.fieldPolicy.applyReadPolicyToMany(
      result.data as unknown as Record<string, unknown>[],
      this.req
    );
    return { ...result, data: stripped as unknown as T[] };
  }

  // ─── Delegated read methods with read policy ──────────────────────────────

  async all(opts?: QueryOptions): Promise<PaginatedResult<T>> {
    const result = await this.base.all(opts);
    return this.applyReadPolicyToResult(result);
  }

  async findById(id: string, opts?: QueryOptions): Promise<T | null> {
    return this.applyReadPolicy(await this.base.findById(id, opts));
  }

  async findOne(filter: Record<string, unknown>, opts?: QueryOptions): Promise<T | null> {
    return this.applyReadPolicy(await this.base.findOne(filter, opts));
  }

  async findBy(field: string, value: unknown, opts?: QueryOptions): Promise<PaginatedResult<T>> {
    const result = await this.base.findBy(field, value, opts);
    return this.applyReadPolicyToResult(result);
  }

  async search(query: string, opts?: QueryOptions): Promise<PaginatedResult<T>> {
    const result = await this.base.search(query, opts);
    return this.applyReadPolicyToResult(result);
  }

  // ─── Write methods with identity injection + write policy ─────────────────

  async create(data: Partial<T>, opts?: CreateOptions): Promise<T> {
    const guarded  = await this.guardWrite(data);
    const enriched = this.injectIdentity(guarded);
    const doc      = await this.base.create(enriched, opts);
    return (await this.applyReadPolicy(doc))!;
  }

  async createMany(data: Partial<T>[], opts?: CreateOptions): Promise<T[]> {
    const processed = await Promise.all(
      data.map(async (d) => this.injectIdentity(await this.guardWrite(d)))
    );
    const docs = await this.base.createMany(processed, opts);
    const stripped = await this.fieldPolicy?.applyReadPolicyToMany(
      docs as unknown as Record<string, unknown>[],
      this.req
    );
    return (stripped ?? docs) as unknown as T[];
  }

  async update(id: string, data: Partial<T>, opts?: UpdateOptions): Promise<T | null> {
    const guarded  = await this.guardWrite(data);
    const enriched = this.injectIdentity(guarded);
    return this.applyReadPolicy(await this.base.update(id, enriched, opts));
  }

  async updateBy(
    filter: Record<string, unknown>,
    data: Partial<T>,
    opts?: UpdateOptions
  ): Promise<T[]> {
    const guarded  = await this.guardWrite(data);
    const enriched = this.injectIdentity(guarded);
    const docs = await this.base.updateBy(filter, enriched, opts);
    const stripped = await this.fieldPolicy?.applyReadPolicyToMany(
      docs as unknown as Record<string, unknown>[],
      this.req
    );
    return (stripped ?? docs) as unknown as T[];
  }

  async updateField(id: string, field: string, value: unknown, opts?: UpdateOptions): Promise<T | null> {
    // Check write policy for the specific field
    if (this.fieldPolicy?.hasPolicy()) {
      const guarded = await this.guardWrite({ [field]: value } as Partial<T>);
      if (!(field in guarded)) return this.base.findById(id); // field was stripped
      value = (guarded as any)[field];
    }
    return this.applyReadPolicy(await this.base.updateField(id, field, value, opts));
  }

  // ─── Pass-through methods ─────────────────────────────────────────────────

  async delete(id: string, opts?: DeleteOptions): Promise<boolean> {
    return this.base.delete(id, opts);
  }

  async deleteBy(filter: Record<string, unknown>, opts?: DeleteOptions): Promise<number> {
    return this.base.deleteBy(filter, opts);
  }

  async restore(id: string): Promise<T | null> {
    return this.applyReadPolicy(await this.base.restore(id));
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    return this.base.count(filter);
  }

  async exists(filter: Record<string, unknown>): Promise<boolean> {
    return this.base.exists(filter);
  }

  async withChildren(id: string, opts?: QueryOptions): Promise<T | null> {
    return this.applyReadPolicy(await this.base.withChildren(id, opts));
  }

  validate(data: unknown, mode: "create" | "update"): ValidationResult {
    return this.base.validate(data, mode);
  }
}
