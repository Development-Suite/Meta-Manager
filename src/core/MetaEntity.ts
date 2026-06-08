import mongoose, { Model, Schema } from "mongoose";
import { Router } from "express";
import {
  BaseEntityDocument,
  MetaEntityOptions,
  IMetaEntity,
  IMetaService,
  EventPath,
  EventCallback,
  CallbackForEvent,
  InterceptorAction,
  InterceptorCallback,
} from "../types";
import { NestedOpPayload, NestedOpResult } from "../types/nestedOps";
import { AnalysisOptions, AnalysisResult } from "../types/analysis";
import { AuditLogOptions, ScopedServiceOptions } from "../types/features";
import { MetaService } from "./MetaService";
import { MetaController } from "./MetaController";
import { MetaEventEmitter } from "./EventEmitter";
import { NestedOpsService } from "./NestedOpsService";
import { MetaAnalysisService } from "./MetaAnalysisService";
import { AuditLogService } from "./AuditLogService";
import { WebhookService, patchEmitterForWebhooks } from "./WebhookService";
import { FieldPolicyService } from "./FieldPolicyService";
import { ScopedMetaService } from "./ScopedMetaService";
import { buildSchema } from "./SchemaBuilder";

export class MetaEntity<T extends BaseEntityDocument = BaseEntityDocument>
  implements IMetaEntity<T>
{
  readonly entityName: string;
  readonly model: Model<T>;
  readonly service: IMetaService<T>;
  readonly controller: Router;

  private readonly events: MetaEventEmitter;
  private readonly _controller: MetaController<T>;
  private readonly options: MetaEntityOptions;
  readonly nestedOps: NestedOpsService<T>;
  readonly analysis: MetaAnalysisService<T>;
  readonly auditLog: AuditLogService | null;
  private readonly fieldPolicySvc: FieldPolicyService | null;

  constructor(name: string, options: MetaEntityOptions = {}) {
    this.entityName = name;
    this.options = options;

    this.assertMongooseConnection();

    const schema: Schema = buildSchema(options);
    const collectionName = options.collectionName || name.toLowerCase().replace(/\s+/g, "_");

    this.model =
      (mongoose.models[name] as Model<T>) ||
      mongoose.model<T>(name, schema, collectionName);

    this.events = new MetaEventEmitter();
    this.service = new MetaService<T>(this.model, options, this.events, name);
    this.nestedOps = new NestedOpsService<T>(this.model, this.events);
    this.analysis  = new MetaAnalysisService<T>(this.model, name, this.events);

    // Field policy service
    this.fieldPolicySvc = options.fieldPolicy
      ? new FieldPolicyService(options.fieldPolicy)
      : null;

    // Audit log
    const auditOpts = options.auditLog === true
      ? { enabled: true } as AuditLogOptions
      : options.auditLog || null;
    this.auditLog = auditOpts?.enabled
      ? new AuditLogService(name, this.events, auditOpts)
      : null;

    // Webhooks — patch emitter first so __lastEvent tag is available
    if (options.webhooks?.length) {
      patchEmitterForWebhooks(this.events);
      new WebhookService(name, this.events, options.webhooks);
    }

    this._controller = new MetaController<T>(
      this.service,
      this.nestedOps,
      this.analysis,
      name,
      options,
      this.fieldPolicySvc,
      this.auditLog
    );
    this.controller = this._controller.router;
  }

  private assertMongooseConnection(): void {
    const state = mongoose.connection.readyState;
    if (state === 0) {
      throw new Error(
        `[MetaManager] No active MongoDB connection detected when initializing entity "${this.entityName}". ` +
          `Call mongoose.connect() before creating MetaEntity instances.`
      );
    }
  }

  /**
   * Subscribe to entity lifecycle events with full TypeScript path inference.
   *
   * @example
   * booksEntity.trigger(["create"], (whatWas, whatIs, book) => { ... });
   * booksEntity.trigger(["update.title_name"], (whatWas, whatIs, book) => { ... });
   * booksEntity.trigger(["update.extra_data[*]"], (whatWas, whatIs, book) => { ... });
   * booksEntity.trigger(["update.extra_data[tokenName].Zugacoin"], (whatWas, whatIs, book) => { ... });
   */
  /**
   * Apply a single nested operation directly via the service layer (no HTTP).
   *
   * @example
   * await profileEntity.nested(id, {
   *   field: "services",
   *   operation: "patch_item",
   *   value: { _mmid: "abc123", "sub_services.0.basket_rate": 4000 }
   * });
   */
  /**
   * Run an analysis query directly via the service layer (no HTTP).
   * @example
   * await booksEntity.analyze({ type: "growth", window: { from: "2026-05-01", to: "2026-05-28" } })
   * await booksEntity.analyze({ type: "sum", field: "amount", window: { from, to } })
   */
  /**
   * Returns a service pre-scoped to the caller identified by the request.
   * Automatically fills created_by, updated_by, added_by.
   * Enforces field-level read and write policies.
   */
  serviceFor(req: import("../types").CustomRequest): import("../types").IMetaService<T> {
    const scopeOpts: ScopedServiceOptions = this.options.scopedService || {};
    return new ScopedMetaService<T>(
      this.service,
      req,
      this.fieldPolicySvc,
      scopeOpts
    );
  }

  /**
   * Fetch audit history for a specific document.
   * Only available when auditLog is enabled.
   */
  async getHistory(
    entityId: string,
    options?: { limit?: number; page?: number; event?: string }
  ): Promise<{ data: import("../types/features").AuditRecord[]; total: number }> {
    if (!this.auditLog) return { data: [], total: 0 };
    return this.auditLog.getHistory(entityId, options);
  }

  async analyze(options: AnalysisOptions): Promise<AnalysisResult> {
    return this.analysis.run(options);
  }

  async nested(id: string, payload: NestedOpPayload): Promise<NestedOpResult<T>> {
    return this.nestedOps.apply(id, payload);
  }

  /**
   * Apply multiple nested operations in one call (batched into as few DB
   * round-trips as possible).
   */
  async nestedBatch(id: string, payloads: NestedOpPayload[]): Promise<NestedOpResult<T>> {
    return this.nestedOps.applyMany(id, payloads);
  }

  trigger<E extends EventPath<T>>(events: E[], callback: CallbackForEvent<T, E>): void {
    this.events.on(events as string[], callback as EventCallback<any>);
  }

  /**
   * Register middleware that runs before the specified controller action(s).
   *
   * @example
   * booksEntity.intercept("delete", (req, res, next) => {
   *   if (!req.user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
   *   next();
   * });
   */
  intercept(
    action: InterceptorAction | InterceptorAction[],
    callback: InterceptorCallback
  ): void {
    this._controller.addInterceptor(action, callback);
  }
}
