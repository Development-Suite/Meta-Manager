import { Model } from "mongoose";
import { BaseEntityDocument } from "../types";
import { MetaEventEmitter } from "./EventEmitter";
import {
  AnalysisType,
  AnalysisOptions,
  AnalysisResult,
  AnalysisThreshold,
  TimeUnit,
  TimeWindow,
  CountResult,
  GrowthResult,
  SumResult,
  AverageResult,
  MinMaxResult,
  DistributionResult,
  TimeseriesResult,
  TopResult,
  RateResult,
  FieldChangeResult,
  FunnelResult,
  PercentileResult,
} from "../types/analysis";

export class MetaAnalysisService<T extends BaseEntityDocument = BaseEntityDocument> {
  constructor(
    private readonly model: Model<T>,
    private readonly entityName: string,
    private readonly events: MetaEventEmitter
  ) {}

  // ── Public entry point ────────────────────────────────────────────────────

  async run(options: AnalysisOptions): Promise<AnalysisResult> {
    const result = await this.dispatch(options);
    await this.checkThreshold(result, options.threshold);
    return result;
  }

  private async dispatch(options: AnalysisOptions): Promise<AnalysisResult> {
    switch (options.type) {
      case "count":       return this.runCount(options);
      case "growth":      return this.runGrowth(options);
      case "sum":         return this.runSum(options);
      case "average":     return this.runAverage(options);
      case "min_max":     return this.runMinMax(options);
      case "distribution":return this.runDistribution(options);
      case "timeseries":  return this.runTimeseries(options);
      case "top":         return this.runTop(options);
      case "rate":        return this.runRate(options);
      case "field_change":return this.runFieldChange(options);
      case "funnel":      return this.runFunnel(options);
      case "percentile":  return this.runPercentile(options);
      default:
        throw new Error(`Unknown analysis type: "${(options as any).type}"`);
    }
  }

  // ── Threshold event ───────────────────────────────────────────────────────

  private async checkThreshold(
    result: AnalysisResult,
    threshold?: AnalysisThreshold
  ): Promise<void> {
    if (!threshold) return;

    const metricValue = (result as any)[threshold.metric];
    if (typeof metricValue !== "number") return;

    let crossed = false;
    switch (threshold.operator) {
      case "gt":  crossed = metricValue >  threshold.value; break;
      case "gte": crossed = metricValue >= threshold.value; break;
      case "lt":  crossed = metricValue <  threshold.value; break;
      case "lte": crossed = metricValue <= threshold.value; break;
      case "eq":  crossed = metricValue === threshold.value; break;
    }

    if (crossed) {
      await this.events.emit(
        `analysis.${result.type}_threshold`,
        null,
        { metric: threshold.metric, value: metricValue, threshold: threshold.value, operator: threshold.operator },
        { ...result, threshold } as any
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resolveWindow(window?: TimeWindow): { from: Date; to: Date } {
    const to   = window?.to   ? new Date(window.to)   : new Date();
    const from = window?.from ? new Date(window.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    return { from, to };
  }

  private previousWindow(from: Date, to: Date): { from: Date; to: Date } {
    const duration = to.getTime() - from.getTime();
    return {
      from: new Date(from.getTime() - duration),
      to:   new Date(from.getTime()),
    };
  }

  private windowFilter(
    from: Date,
    to: Date,
    dateField: string,
    extra?: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      deleted_at: null,
      [dateField]: { $gte: from, $lte: to },
      ...(extra || {}),
    };
  }

  private intervalMs(unit: TimeUnit): number {
    const MS = 1000;
    switch (unit) {
      case "hour":  return 60 * 60 * MS;
      case "day":   return 24 * 60 * 60 * MS;
      case "week":  return 7  * 24 * 60 * 60 * MS;
      case "month": return 30 * 24 * 60 * 60 * MS;
    }
  }

  private bucketLabel(date: Date, unit: TimeUnit): string {
    const d = date;
    switch (unit) {
      case "hour":
        return `${d.toISOString().slice(0, 13)}:00`;
      case "day":
        return d.toISOString().slice(0, 10);
      case "week": {
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        return startOfWeek.toISOString().slice(0, 10);
      }
      case "month":
        return d.toISOString().slice(0, 7);
    }
  }

  private requireField(field: string | undefined, type: string): string {
    if (!field) throw new Error(`Analysis type "${type}" requires the "field" option.`);
    return field;
  }

  // ── count ─────────────────────────────────────────────────────────────────

  private async runCount(opts: AnalysisOptions): Promise<CountResult> {
    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";
    const count = await this.model.countDocuments(
      this.windowFilter(from, to, dateField, opts.filter) as any
    );
    return { type: "count", count, window: { from, to } };
  }

  // ── growth ────────────────────────────────────────────────────────────────

  private async runGrowth(opts: AnalysisOptions): Promise<GrowthResult> {
    const { from, to } = this.resolveWindow(opts.window);
    const prev = this.previousWindow(from, to);
    const dateField = opts.dateField || "created_at";

    const [current, previous] = await Promise.all([
      this.model.countDocuments(this.windowFilter(from, to, dateField, opts.filter) as any),
      this.model.countDocuments(this.windowFilter(prev.from, prev.to, dateField, opts.filter) as any),
    ]);

    const growthAbsolute = current - previous;
    const growthPercent  = previous === 0
      ? (current > 0 ? 100 : 0)
      : parseFloat(((growthAbsolute / previous) * 100).toFixed(2));

    return {
      type: "growth",
      current,
      previous,
      growthPercent,
      growthAbsolute,
      currentWindow:  { from, to },
      previousWindow: prev,
    };
  }

  // ── sum ───────────────────────────────────────────────────────────────────

  private async runSum(opts: AnalysisOptions): Promise<SumResult> {
    const field = this.requireField(opts.field, "sum");
    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";

    const [agg] = await this.model.aggregate([
      { $match: this.windowFilter(from, to, dateField, opts.filter) },
      { $group: { _id: null, total: { $sum: `$${field}` }, count: { $sum: 1 } } },
    ]);

    return {
      type: "sum",
      field,
      total: agg?.total ?? 0,
      count: agg?.count ?? 0,
      window: { from, to },
    };
  }

  // ── average ───────────────────────────────────────────────────────────────

  private async runAverage(opts: AnalysisOptions): Promise<AverageResult> {
    const field = this.requireField(opts.field, "average");
    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";

    const [agg] = await this.model.aggregate([
      { $match: this.windowFilter(from, to, dateField, opts.filter) },
      { $group: { _id: null, average: { $avg: `$${field}` }, count: { $sum: 1 } } },
    ]);

    return {
      type: "average",
      field,
      average: agg?.average != null ? parseFloat(agg.average.toFixed(4)) : 0,
      count:   agg?.count ?? 0,
      window:  { from, to },
    };
  }

  // ── min_max ───────────────────────────────────────────────────────────────

  private async runMinMax(opts: AnalysisOptions): Promise<MinMaxResult> {
    const field = this.requireField(opts.field, "min_max");
    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";

    const [agg] = await this.model.aggregate([
      { $match: this.windowFilter(from, to, dateField, opts.filter) },
      {
        $group: {
          _id:   null,
          min:   { $min: `$${field}` },
          max:   { $max: `$${field}` },
          count: { $sum: 1 },
        },
      },
    ]);

    const min = agg?.min ?? 0;
    const max = agg?.max ?? 0;

    return {
      type: "min_max",
      field,
      min,
      max,
      range: max - min,
      count: agg?.count ?? 0,
      window: { from, to },
    };
  }

  // ── distribution ──────────────────────────────────────────────────────────

  private async runDistribution(opts: AnalysisOptions): Promise<DistributionResult> {
    const field = opts.groupBy || this.requireField(opts.field, "distribution");
    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";
    const limit = opts.limit || 20;

    const agg = await this.model.aggregate([
      { $match: this.windowFilter(from, to, dateField, opts.filter) },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    const total = agg.reduce((s: number, b: any) => s + b.count, 0);

    return {
      type: "distribution",
      field,
      buckets: agg.map((b: any) => ({
        value:   b._id ?? "(none)",
        count:   b.count,
        percent: total > 0 ? parseFloat(((b.count / total) * 100).toFixed(2)) : 0,
      })),
      total,
      window: { from, to },
    };
  }

  // ── timeseries ────────────────────────────────────────────────────────────

  private async runTimeseries(opts: AnalysisOptions): Promise<TimeseriesResult> {
    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";
    const interval  = opts.interval || "day";
    const metric    = opts.metric || "count";
    const field     = opts.field;

    if (metric === "sum" && !field) {
      throw new Error('Timeseries with metric="sum" requires the "field" option.');
    }

    // Build time buckets
    const bucketMs = this.intervalMs(interval);
    const points: { bucket: string; value: number }[] = [];
    let cursor = new Date(from.getTime());

    while (cursor <= to) {
      const bucketEnd = new Date(Math.min(cursor.getTime() + bucketMs, to.getTime()));
      const filter = this.windowFilter(cursor, bucketEnd, dateField, opts.filter);

      let value: number;
      if (metric === "count") {
        value = await this.model.countDocuments(filter as any);
      } else {
        const [agg] = await this.model.aggregate([
          { $match: filter },
          { $group: { _id: null, total: { $sum: `$${field}` } } },
        ]);
        value = agg?.total ?? 0;
      }

      points.push({ bucket: this.bucketLabel(cursor, interval), value });
      cursor = new Date(cursor.getTime() + bucketMs);
    }

    return {
      type: "timeseries",
      interval,
      metric,
      field,
      points,
      window: { from, to },
    };
  }

  // ── top ───────────────────────────────────────────────────────────────────

  private async runTop(opts: AnalysisOptions): Promise<TopResult> {
    const field = this.requireField(opts.field, "top");
    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";
    const limit = opts.limit || 10;

    const items = await this.model
      .find(this.windowFilter(from, to, dateField, opts.filter) as any)
      .sort({ [field]: -1 } as any)
      .limit(limit)
      .lean();

    return {
      type: "top",
      field,
      limit,
      items: items as Record<string, unknown>[],
      window: { from, to },
    };
  }

  // ── rate ──────────────────────────────────────────────────────────────────

  private async runRate(opts: AnalysisOptions): Promise<RateResult> {
    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";
    const interval  = opts.interval || "day";

    const total = await this.model.countDocuments(
      this.windowFilter(from, to, dateField, opts.filter) as any
    );

    const windowMs    = to.getTime() - from.getTime();
    const intervalMs  = this.intervalMs(interval);
    const intervals   = windowMs / intervalMs;
    const rate        = intervals > 0 ? parseFloat((total / intervals).toFixed(4)) : 0;

    return {
      type: "rate",
      interval,
      rate,
      total,
      intervals: parseFloat(intervals.toFixed(2)),
      window: { from, to },
    };
  }

  // ── field_change ──────────────────────────────────────────────────────────

  private async runFieldChange(opts: AnalysisOptions): Promise<FieldChangeResult> {
    const field = this.requireField(opts.field, "field_change");
    const { from, to } = this.resolveWindow(opts.window);
    const prev = this.previousWindow(from, to);
    const dateField = opts.dateField || "created_at";

    const sumFor = async (f: Date, t: Date): Promise<number> => {
      const [agg] = await this.model.aggregate([
        { $match: this.windowFilter(f, t, dateField, opts.filter) },
        { $group: { _id: null, total: { $sum: `$${field}` } } },
      ]);
      return agg?.total ?? 0;
    };

    const [current, previous] = await Promise.all([
      sumFor(from, to),
      sumFor(prev.from, prev.to),
    ]);

    const deltaAbsolute = parseFloat((current - previous).toFixed(4));
    const deltaPercent  = previous === 0
      ? (current > 0 ? 100 : 0)
      : parseFloat(((deltaAbsolute / Math.abs(previous)) * 100).toFixed(2));

    return {
      type: "field_change",
      field,
      current,
      previous,
      deltaAbsolute,
      deltaPercent,
      currentWindow:  { from, to },
      previousWindow: prev,
    };
  }

  // ── funnel ────────────────────────────────────────────────────────────────

  private async runFunnel(opts: AnalysisOptions): Promise<FunnelResult> {
    const field  = opts.groupBy || this.requireField(opts.field, "funnel");
    const stages = opts.stages;
    if (!stages || stages.length < 2) {
      throw new Error('Funnel analysis requires "stages" with at least 2 values.');
    }

    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";
    const baseFilter = this.windowFilter(from, to, dateField, opts.filter);

    const counts = await Promise.all(
      stages.map((stage) =>
        this.model.countDocuments({ ...baseFilter, [field]: stage } as any)
      )
    );

    const topCount = counts[0] || 0;

    const stageResults = stages.map((stage, i) => {
      const count   = counts[i];
      const percent = topCount > 0 ? parseFloat(((count / topCount) * 100).toFixed(2)) : 0;
      const prevCount = i === 0 ? topCount : counts[i - 1];
      const dropoffPercent = prevCount > 0
        ? parseFloat((((prevCount - count) / prevCount) * 100).toFixed(2))
        : 0;
      return { value: stage, count, percent, dropoffPercent };
    });

    return {
      type: "funnel",
      field,
      stages: stageResults,
      window: { from, to },
    };
  }

  // ── percentile ────────────────────────────────────────────────────────────

  private async runPercentile(opts: AnalysisOptions): Promise<PercentileResult> {
    const field = this.requireField(opts.field, "percentile");
    const { from, to } = this.resolveWindow(opts.window);
    const dateField = opts.dateField || "created_at";

    const docs = await this.model
      .find(this.windowFilter(from, to, dateField, opts.filter) as any)
      .select(field)
      .lean();

    const values = (docs as any[])
      .map((d) => d[field])
      .filter((v) => typeof v === "number")
      .sort((a, b) => a - b);

    const count = values.length;

    const pct = (p: number): number => {
      if (count === 0) return 0;
      const idx = Math.ceil((p / 100) * count) - 1;
      return values[Math.max(0, idx)];
    };

    return {
      type: "percentile",
      field,
      p50: pct(50),
      p75: pct(75),
      p90: pct(90),
      p95: pct(95),
      p99: pct(99),
      count,
      window: { from, to },
    };
  }
}
