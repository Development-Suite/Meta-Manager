import { Router, NextFunction } from "express";
import { CustomRequest, CustomResponse, InterceptorConfig, InterceptorAction, InterceptorCallback, MetaEntityOptions } from "../types";
import { IMetaService, BaseEntityDocument } from "../types";
import { NestedOpsService } from "./NestedOpsService";
import { MetaAnalysisService } from "./MetaAnalysisService";
export declare class MetaController<T extends BaseEntityDocument = BaseEntityDocument> {
    private readonly service;
    private readonly nestedOpsService;
    private readonly analysisService;
    private readonly entityName;
    private readonly options;
    readonly router: Router;
    readonly interceptors: InterceptorConfig[];
    constructor(service: IMetaService<T>, nestedOpsService: NestedOpsService<T>, analysisService: MetaAnalysisService<T>, entityName: string, options: MetaEntityOptions);
    addInterceptor(action: InterceptorAction | InterceptorAction[], callback: InterceptorCallback): void;
    /**
     * Returns the callbacks that should run for a given action and request.
     *
     * Matching rules:
     *   "all"              - always matches
     *   "create/read/delete" - matches exact action
     *   "update"           - matches any update regardless of fields
     *   "update.fieldName" - matches only when the request targets that field
     */
    getInterceptors(action: InterceptorAction, req?: CustomRequest): InterceptorCallback[];
    private matchesPattern;
    applyInterceptors(action: InterceptorAction, req: CustomRequest, res: CustomResponse, next: NextFunction): void;
    private registerRoutes;
    private intercept;
    private isJoiOrValidationError;
    private handleAll;
    private handleSearch;
    private handleCount;
    private handleFindBy;
    private handleCreate;
    private handleCreateMany;
    private handleGetById;
    private handleGetWithChildren;
    private handleUpdate;
    private handleUpdateField;
    private handleDelete;
    private handleRestore;
    private handleExists;
}
//# sourceMappingURL=MetaController.d.ts.map