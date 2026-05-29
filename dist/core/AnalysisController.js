"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalysisController = void 0;
const serverResponse_1 = __importDefault(require("../utils/serverResponse"));
const VALID_TYPES = [
    "count", "growth", "sum", "average", "min_max",
    "distribution", "timeseries", "top", "rate",
    "field_change", "funnel", "percentile",
];
class AnalysisController {
    constructor(service, entityName) {
        this.service = service;
        this.entityName = entityName;
    }
    mount(router) {
        // GET /analysis/:type
        router.get("/analysis/:type", this.handle.bind(this));
        // POST /analysis/:type  — allows sending larger filter/stages in body
        router.post("/analysis/:type", this.handle.bind(this));
    }
    async handle(req, res) {
        try {
            const type = req.params.type;
            if (!VALID_TYPES.includes(type)) {
                serverResponse_1.default.handleError(req, res, "badRequest", `Unknown analysis type "${type}". Valid types: ${VALID_TYPES.join(", ")}`);
                return;
            }
            const opts = this.parseOptions(type, req);
            const result = await this.service.run(opts);
            serverResponse_1.default.handleResponse(req, res, result, "success", `${this.entityName} ${type} analysis`);
        }
        catch (err) {
            if (err.message?.includes("requires")) {
                serverResponse_1.default.handleError(req, res, "badRequest", err.message, err);
            }
            else {
                serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
            }
        }
    }
    parseOptions(type, req) {
        // Merge query params and body
        const q = req.query;
        const b = (req.body || {});
        const get = (key) => b[key] ?? q[key];
        const from = get("from");
        const to = get("to");
        // Filter: filter[status]=active in query OR filter: {} in body
        const filterFromQuery = {};
        for (const key of Object.keys(q)) {
            const m = key.match(/^filter\[(.+)\]$/);
            if (m)
                filterFromQuery[m[1]] = q[key];
        }
        const filter = Object.keys(filterFromQuery).length > 0
            ? filterFromQuery
            : b.filter;
        // Funnel stages: stages=pending,accepted,completed OR body.stages array
        let stages;
        if (b.stages && Array.isArray(b.stages)) {
            stages = b.stages;
        }
        else if (q.stages) {
            stages = q.stages.split(",").map((s) => s.trim()).filter(Boolean);
        }
        // Threshold from query: threshold_metric, threshold_operator, threshold_value
        let threshold;
        const tm = get("threshold_metric");
        const to2 = get("threshold_operator");
        const tv = get("threshold_value");
        if (tm && to2 && tv !== undefined) {
            threshold = {
                metric: tm,
                operator: to2,
                value: parseFloat(tv),
            };
        }
        return {
            type,
            window: from || to ? { from, to } : undefined,
            dateField: get("dateField"),
            field: get("field"),
            groupBy: get("groupBy"),
            limit: get("limit") ? parseInt(get("limit"), 10) : undefined,
            interval: get("interval"),
            metric: get("metric"),
            stages,
            filter,
            threshold,
        };
    }
}
exports.AnalysisController = AnalysisController;
//# sourceMappingURL=AnalysisController.js.map