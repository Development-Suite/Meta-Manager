import { Router } from "express";
import { MetaAnalysisService } from "./MetaAnalysisService";
import { BaseEntityDocument } from "../types";
export declare class AnalysisController<T extends BaseEntityDocument = BaseEntityDocument> {
    private readonly service;
    private readonly entityName;
    constructor(service: MetaAnalysisService<T>, entityName: string);
    mount(router: Router): void;
    private handle;
    private parseOptions;
}
//# sourceMappingURL=AnalysisController.d.ts.map