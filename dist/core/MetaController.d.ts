import { Router } from "express";
import { InterceptorAction, InterceptorCallback, MetaEntityOptions } from "../types";
import { IMetaService, BaseEntityDocument } from "../types";
export declare class MetaController<T extends BaseEntityDocument = BaseEntityDocument> {
    private readonly service;
    private readonly entityName;
    private readonly options;
    readonly router: Router;
    private interceptors;
    constructor(service: IMetaService<T>, entityName: string, options: MetaEntityOptions);
    addInterceptor(action: InterceptorAction | InterceptorAction[], callback: InterceptorCallback): void;
    private getInterceptors;
    private applyInterceptors;
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