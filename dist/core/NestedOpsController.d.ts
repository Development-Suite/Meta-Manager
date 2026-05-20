import { Router } from "express";
import { CustomRequest, InterceptorCallback } from "../types";
import { NestedOpsService } from "./NestedOpsService";
import { BaseEntityDocument } from "../types";
export declare class NestedOpsController<T extends BaseEntityDocument = BaseEntityDocument> {
    private readonly service;
    private readonly entityName;
    private readonly getInterceptors;
    constructor(service: NestedOpsService<T>, entityName: string, getInterceptors: (action: string, req?: CustomRequest) => InterceptorCallback[]);
    mount(router: Router): void;
    private runInterceptors;
    private handleSingle;
    private handleBatch;
}
//# sourceMappingURL=NestedOpsController.d.ts.map