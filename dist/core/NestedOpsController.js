"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NestedOpsController = void 0;
const serverResponse_1 = __importDefault(require("../utils/serverResponse"));
class NestedOpsController {
    constructor(service, entityName, getInterceptors) {
        this.service = service;
        this.entityName = entityName;
        this.getInterceptors = getInterceptors;
    }
    mount(router) {
        // Single nested operation
        // PATCH /:id/nested
        router.patch("/:id/nested", this.runInterceptors("update"), this.handleSingle.bind(this));
        // Multiple nested operations in one request
        // PATCH /:id/nested/batch
        router.patch("/:id/nested/batch", this.runInterceptors("update"), this.handleBatch.bind(this));
    }
    runInterceptors(action) {
        return (req, res, next) => {
            const middlewares = this.getInterceptors(action, req);
            if (middlewares.length === 0)
                return next();
            let idx = 0;
            const run = () => {
                if (idx >= middlewares.length)
                    return next();
                const mw = middlewares[idx++];
                Promise.resolve(mw(req, res, run)).catch(next);
            };
            run();
        };
    }
    async handleSingle(req, res) {
        try {
            const { id } = req.params;
            const { field, operation, value } = req.body;
            if (!field || !operation) {
                serverResponse_1.default.handleError(req, res, "badRequest", "Body must contain: field, operation, value");
                return;
            }
            const result = await this.service.apply(id, { field, operation, value });
            if (!result.updated) {
                serverResponse_1.default.handleError(req, res, "notFound", `${this.entityName} not found`);
                return;
            }
            serverResponse_1.default.handleResponse(req, res, result.updated, "success", `${this.entityName} nested field updated`);
        }
        catch (err) {
            if (err.message?.includes("requires") || err.message?.includes("Unknown")) {
                serverResponse_1.default.handleError(req, res, "badRequest", err.message, err);
            }
            else {
                serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
            }
        }
    }
    async handleBatch(req, res) {
        try {
            const { id } = req.params;
            const ops = Array.isArray(req.body) ? req.body : req.body?.ops;
            if (!Array.isArray(ops) || ops.length === 0) {
                serverResponse_1.default.handleError(req, res, "badRequest", "Body must be an array of operations, or { ops: [...] }");
                return;
            }
            for (let i = 0; i < ops.length; i++) {
                if (!ops[i].field || !ops[i].operation) {
                    serverResponse_1.default.handleError(req, res, "badRequest", `Operation at index ${i} is missing field or operation`);
                    return;
                }
            }
            const result = await this.service.applyMany(id, ops);
            if (!result.updated) {
                serverResponse_1.default.handleError(req, res, "notFound", `${this.entityName} not found`);
                return;
            }
            serverResponse_1.default.handleResponse(req, res, result.updated, "success", `${this.entityName} nested fields updated`);
        }
        catch (err) {
            if (err.message?.includes("requires") || err.message?.includes("Unknown")) {
                serverResponse_1.default.handleError(req, res, "badRequest", err.message, err);
            }
            else {
                serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
            }
        }
    }
}
exports.NestedOpsController = NestedOpsController;
//# sourceMappingURL=NestedOpsController.js.map