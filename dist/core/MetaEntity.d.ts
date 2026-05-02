import { Model } from "mongoose";
import { Router } from "express";
import { BaseEntityDocument, MetaEntityOptions, IMetaEntity, IMetaService, EventPath, CallbackForEvent, InterceptorAction, InterceptorCallback } from "../types";
export declare class MetaEntity<T extends BaseEntityDocument = BaseEntityDocument> implements IMetaEntity<T> {
    readonly entityName: string;
    readonly model: Model<T>;
    readonly service: IMetaService<T>;
    readonly controller: Router;
    private readonly events;
    private readonly _controller;
    private readonly options;
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