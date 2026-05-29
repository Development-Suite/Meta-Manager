import { Model } from "mongoose";
import { BaseEntityDocument } from "../types";
import { MetaEventEmitter } from "./EventEmitter";
import { AnalysisOptions, AnalysisResult } from "../types/analysis";
export declare class MetaAnalysisService<T extends BaseEntityDocument = BaseEntityDocument> {
    private readonly model;
    private readonly entityName;
    private readonly events;
    constructor(model: Model<T>, entityName: string, events: MetaEventEmitter);
    run(options: AnalysisOptions): Promise<AnalysisResult>;
    private dispatch;
    private checkThreshold;
    private resolveWindow;
    private previousWindow;
    private windowFilter;
    private intervalMs;
    private bucketLabel;
    private requireField;
    private runCount;
    private runGrowth;
    private runSum;
    private runAverage;
    private runMinMax;
    private runDistribution;
    private runTimeseries;
    private runTop;
    private runRate;
    private runFieldChange;
    private runFunnel;
    private runPercentile;
}
//# sourceMappingURL=MetaAnalysisService.d.ts.map