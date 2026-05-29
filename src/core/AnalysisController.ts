import { Router } from "express";
import { MetaAnalysisService } from "./MetaAnalysisService";
import { BaseEntityDocument, CustomRequest, CustomResponse } from "../types";
import { AnalysisType, AnalysisOptions, TimeUnit } from "../types/analysis";
import serverResponse from "../utils/serverResponse";

const VALID_TYPES: AnalysisType[] = [
  "count", "growth", "sum", "average", "min_max",
  "distribution", "timeseries", "top", "rate",
  "field_change", "funnel", "percentile",
];

export class AnalysisController<T extends BaseEntityDocument = BaseEntityDocument> {
  constructor(
    private readonly service: MetaAnalysisService<T>,
    private readonly entityName: string
  ) {}

  mount(router: Router): void {
    // GET /analysis/:type
    router.get("/analysis/:type", this.handle.bind(this));

    // POST /analysis/:type  — allows sending larger filter/stages in body
    router.post("/analysis/:type", this.handle.bind(this));
  }

  private async handle(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const type = req.params.type as AnalysisType;

      if (!VALID_TYPES.includes(type)) {
        serverResponse.handleError(
          req, res, "badRequest",
          `Unknown analysis type "${type}". Valid types: ${VALID_TYPES.join(", ")}`
        );
        return;
      }

      const opts = this.parseOptions(type, req);
      const result = await this.service.run(opts);
      serverResponse.handleResponse(req, res, result, "success", `${this.entityName} ${type} analysis`);
    } catch (err: any) {
      if (err.message?.includes("requires")) {
        serverResponse.handleError(req, res, "badRequest", err.message, err);
      } else {
        serverResponse.handleError(req, res, "internalServerError", undefined, err);
      }
    }
  }

  private parseOptions(type: AnalysisType, req: CustomRequest): AnalysisOptions {
    // Merge query params and body
    const q   = req.query as Record<string, string>;
    const b   = (req.body || {}) as Record<string, unknown>;

    const get = (key: string): unknown => b[key] ?? q[key];

    const from = get("from") as string | undefined;
    const to   = get("to")   as string | undefined;

    // Filter: filter[status]=active in query OR filter: {} in body
    const filterFromQuery: Record<string, unknown> = {};
    for (const key of Object.keys(q)) {
      const m = key.match(/^filter\[(.+)\]$/);
      if (m) filterFromQuery[m[1]] = q[key];
    }
    const filter = Object.keys(filterFromQuery).length > 0
      ? filterFromQuery
      : (b.filter as Record<string, unknown> | undefined);

    // Funnel stages: stages=pending,accepted,completed OR body.stages array
    let stages: string[] | undefined;
    if (b.stages && Array.isArray(b.stages)) {
      stages = b.stages as string[];
    } else if (q.stages) {
      stages = q.stages.split(",").map((s) => s.trim()).filter(Boolean);
    }

    // Threshold from query: threshold_metric, threshold_operator, threshold_value
    let threshold: AnalysisOptions["threshold"];
    const tm = get("threshold_metric") as string | undefined;
    const to2 = get("threshold_operator") as string | undefined;
    const tv  = get("threshold_value") as string | undefined;
    if (tm && to2 && tv !== undefined) {
      threshold = {
        metric:   tm,
        operator: to2 as any,
        value:    parseFloat(tv),
      };
    }

    return {
      type,
      window:    from || to ? { from, to } : undefined,
      dateField: get("dateField") as string | undefined,
      field:     get("field")     as string | undefined,
      groupBy:   get("groupBy")   as string | undefined,
      limit:     get("limit") ? parseInt(get("limit") as string, 10) : undefined,
      interval:  get("interval")  as TimeUnit | undefined,
      metric:    get("metric")    as "count" | "sum" | undefined,
      stages,
      filter,
      threshold,
    };
  }
}
