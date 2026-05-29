/**
 * Analysis types supported by MetaAnalysisService.
 *
 *  count          - Total document count in a time window.
 *  growth         - Percentage change in count between two equal consecutive periods.
 *  sum            - Sum of a numeric field in a time window.
 *  average        - Mean of a numeric field.
 *  min_max        - Min and max of a numeric field.
 *  distribution   - Count per distinct value of a field (GROUP BY equivalent).
 *  timeseries     - Count or field sum bucketed into equal time intervals.
 *  top            - Top N documents ranked by a numeric field.
 *  rate           - Documents created per time unit (per_hour, per_day, per_week).
 *  field_change   - Absolute and percentage delta of a numeric field sum between two periods.
 *  funnel         - Conversion counts across an ordered sequence of field values.
 *  percentile     - p50 / p75 / p90 / p95 / p99 of a numeric field.
 */
export type AnalysisType = "count" | "growth" | "sum" | "average" | "min_max" | "distribution" | "timeseries" | "top" | "rate" | "field_change" | "funnel" | "percentile";
export type TimeUnit = "hour" | "day" | "week" | "month";
export interface TimeWindow {
    /** ISO 8601 start date. Defaults to 24h ago. */
    from?: string | Date;
    /** ISO 8601 end date. Defaults to now. */
    to?: string | Date;
}
export interface AnalysisOptions {
    /** The analysis to run. */
    type: AnalysisType;
    /** Time window for the primary period. */
    window?: TimeWindow;
    /**
     * The date field used to filter documents into time windows.
     * Defaults to "created_at".
     */
    dateField?: string;
    /**
     * Numeric field to aggregate (required for sum, average, min_max,
     * top, field_change, percentile, and timeseries with metric=sum).
     */
    field?: string;
    /**
     * Field to group distinct values by.
     * Required for: distribution, funnel.
     * Optional for: timeseries (defaults to document count).
     */
    groupBy?: string;
    /** How many buckets or top-N items to return. Defaults to 10. */
    limit?: number;
    /**
     * Time bucket size for timeseries and rate.
     * Defaults to "day".
     */
    interval?: TimeUnit;
    /**
     * What to compute per timeseries bucket: "count" or "sum".
     * Requires field when metric="sum". Defaults to "count".
     */
    metric?: "count" | "sum";
    /**
     * Ordered array of field values defining funnel stages.
     * Required for funnel analysis.
     * e.g. ["pending", "accepted", "in_progress", "completed"]
     */
    stages?: string[];
    /** Arbitrary additional filter applied to all queries. */
    filter?: Record<string, unknown>;
    /**
     * Threshold configuration for analysis triggers.
     * When the primary result metric crosses this value the
     * analysis.{type}_threshold event fires.
     */
    threshold?: AnalysisThreshold;
}
export interface AnalysisThreshold {
    /** The metric field on the result to compare. e.g. "count", "total", "growthPercent" */
    metric: string;
    /** Comparison operator. */
    operator: "gt" | "gte" | "lt" | "lte" | "eq";
    /** The value to compare against. */
    value: number;
}
export interface CountResult {
    type: "count";
    count: number;
    window: {
        from: Date;
        to: Date;
    };
}
export interface GrowthResult {
    type: "growth";
    current: number;
    previous: number;
    growthPercent: number;
    growthAbsolute: number;
    currentWindow: {
        from: Date;
        to: Date;
    };
    previousWindow: {
        from: Date;
        to: Date;
    };
}
export interface SumResult {
    type: "sum";
    field: string;
    total: number;
    count: number;
    window: {
        from: Date;
        to: Date;
    };
}
export interface AverageResult {
    type: "average";
    field: string;
    average: number;
    count: number;
    window: {
        from: Date;
        to: Date;
    };
}
export interface MinMaxResult {
    type: "min_max";
    field: string;
    min: number;
    max: number;
    range: number;
    count: number;
    window: {
        from: Date;
        to: Date;
    };
}
export interface DistributionResult {
    type: "distribution";
    field: string;
    buckets: Array<{
        value: string | number;
        count: number;
        percent: number;
    }>;
    total: number;
    window: {
        from: Date;
        to: Date;
    };
}
export interface TimeseriesResult {
    type: "timeseries";
    interval: TimeUnit;
    metric: "count" | "sum";
    field?: string;
    points: Array<{
        bucket: string;
        value: number;
    }>;
    window: {
        from: Date;
        to: Date;
    };
}
export interface TopResult {
    type: "top";
    field: string;
    limit: number;
    items: Array<Record<string, unknown>>;
    window: {
        from: Date;
        to: Date;
    };
}
export interface RateResult {
    type: "rate";
    interval: TimeUnit;
    rate: number;
    total: number;
    intervals: number;
    window: {
        from: Date;
        to: Date;
    };
}
export interface FieldChangeResult {
    type: "field_change";
    field: string;
    current: number;
    previous: number;
    deltaAbsolute: number;
    deltaPercent: number;
    currentWindow: {
        from: Date;
        to: Date;
    };
    previousWindow: {
        from: Date;
        to: Date;
    };
}
export interface FunnelResult {
    type: "funnel";
    field: string;
    stages: Array<{
        value: string;
        count: number;
        percent: number;
        dropoffPercent: number;
    }>;
    window: {
        from: Date;
        to: Date;
    };
}
export interface PercentileResult {
    type: "percentile";
    field: string;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
    count: number;
    window: {
        from: Date;
        to: Date;
    };
}
export type AnalysisResult = CountResult | GrowthResult | SumResult | AverageResult | MinMaxResult | DistributionResult | TimeseriesResult | TopResult | RateResult | FieldChangeResult | FunnelResult | PercentileResult;
//# sourceMappingURL=analysis.d.ts.map