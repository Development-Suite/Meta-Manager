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
import { MetaService } from "./MetaService";
import { MetaController } from "./MetaController";
import { MetaEventEmitter } from "./EventEmitter";
import { NestedOpsService } from "./NestedOpsService";
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
    this._controller = new MetaController<T>(this.service, this.nestedOps, name, options);
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
