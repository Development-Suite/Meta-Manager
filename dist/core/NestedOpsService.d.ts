import { Model } from "mongoose";
import { BaseEntityDocument } from "../types";
import { NestedOpPayload, NestedOpResult } from "../types/nestedOps";
import { MetaEventEmitter } from "./EventEmitter";
export declare class NestedOpsService<T extends BaseEntityDocument = BaseEntityDocument> {
    private readonly model;
    private readonly events;
    constructor(model: Model<T>, events: MetaEventEmitter);
    private buildIdFilter;
    private toPlain;
    apply(id: string, payload: NestedOpPayload): Promise<NestedOpResult<T>>;
    applyMany(id: string, payloads: NestedOpPayload[]): Promise<NestedOpResult<T>>;
    private buildUpdateQuery;
    private mergeUpdateQueries;
}
//# sourceMappingURL=NestedOpsService.d.ts.map