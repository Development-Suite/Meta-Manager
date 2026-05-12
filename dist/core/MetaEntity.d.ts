import { Model } from "mongoose";
import { Router } from "express";
import { BaseEntityDocument, MetaEntityOptions, IMetaEntity, IMetaService, EventPath, CallbackForEvent, InterceptorAction, InterceptorCallback } from "../types";
import { NestedOpPayload, NestedOpResult } from "../types/nestedOps";
import { NestedOpsService } from "./NestedOpsService";
export declare class MetaEntity<T extends BaseEntityDocument = BaseEntityDocument> implements IMetaEntity<T> {
    readonly entityName: string;
    readonly model: Model<T>;
    readonly service: IMetaService<T>;
    readonly controller: Router;
    private readonly events;
    private readonly _controller;
    private readonly options;
    readonly nestedOps: NestedOpsService<T>;
    constructor(name: string, options?: MetaEntityOptions);
    private assertMongooseConnection;
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
    nested(id: string, payload: NestedOpPayload): Promise<NestedOpResult<T>>;
    /**
     * Apply multiple nested operations in one call (batched into as few DB
     * round-trips as possible).
     */
    nestedBatch(id: string, payloads: NestedOpPayload[]): Promise<NestedOpResult<T>>;
    trigger<E extends EventPath<T>>(events: E[], callback: CallbackForEvent<T, E>): void;
    /**
     * Register middleware that runs before the specified controller action(s).
     *
     * @example
     * booksEntity.intercept("delete", (req, res, next) => {
     *   if (!req.user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
     *   next();
     * });
     */
    intercept(action: InterceptorAction | InterceptorAction[], callback: InterceptorCallback): void;
}
//# sourceMappingURL=MetaEntity.d.ts.map