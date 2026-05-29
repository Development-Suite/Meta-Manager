"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaController = void 0;
const express_1 = require("express");
const types_1 = require("../types");
const serverResponse_1 = __importDefault(require("../utils/serverResponse"));
const queryParser_1 = require("../utils/queryParser");
const NestedOpsController_1 = require("./NestedOpsController");
const AnalysisController_1 = require("./AnalysisController");
class MetaController {
    constructor(service, nestedOpsService, analysisService, entityName, options) {
        this.service = service;
        this.nestedOpsService = nestedOpsService;
        this.analysisService = analysisService;
        this.entityName = entityName;
        this.options = options;
        this.interceptors = [];
        this.router = (0, express_1.Router)();
        this.registerRoutes();
    }
    addInterceptor(action, callback) {
        this.interceptors.push({ action, callback });
    }
    /**
     * Returns the callbacks that should run for a given action and request.
     *
     * Matching rules:
     *   "all"              - always matches
     *   "create/read/delete" - matches exact action
     *   "update"           - matches any update regardless of fields
     *   "update.fieldName" - matches only when the request targets that field
     */
    getInterceptors(action, req) {
        const intendedFields = (action === "update" && req)
            ? (0, types_1.resolveIntendedFields)(req)
            : [];
        return this.interceptors
            .filter((i) => {
            const patterns = Array.isArray(i.action) ? i.action : [i.action];
            return patterns.some((pattern) => this.matchesPattern(pattern, action, intendedFields));
        })
            .map((i) => i.callback);
    }
    matchesPattern(pattern, action, intendedFields) {
        // "all" always fires
        if (pattern === "all")
            return true;
        // exact broad match: "create", "read", "delete", "update"
        if (pattern === action)
            return true;
        // field-targeted update: "update.fieldName" or "update.nested.path"
        if (pattern.startsWith("update.") && action === "update") {
            const targetField = pattern.slice("update.".length);
            // match if any intended field starts with or equals the target
            // e.g. pattern "update.personal_information" fires when
            // intendedFields includes "personal_information.email"
            return intendedFields.some((f) => f === targetField || f.startsWith(targetField + "."));
        }
        return false;
    }
    applyInterceptors(action, req, res, next) {
        // Inject appendData() onto every response so interceptors can append to data
        if (!res.appendData) {
            res._attachedData = {};
            res.appendData = (payload) => {
                res._attachedData = { ...(res._attachedData || {}), ...payload };
            };
        }
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
    }
    registerRoutes() {
        const r = this.router;
        r.get("/all", this.intercept("read"), this.handleAll.bind(this));
        r.get("/search", this.intercept("read"), this.handleSearch.bind(this));
        r.get("/count", this.intercept("read"), this.handleCount.bind(this));
        r.get("/by/:field/:value", this.intercept("read"), this.handleFindBy.bind(this));
        r.get("/exists/:field/:value", this.intercept("read"), this.handleExists.bind(this));
        r.post("/create", this.intercept("create"), this.handleCreate.bind(this));
        r.post("/create/many", this.intercept("create"), this.handleCreateMany.bind(this));
        r.get("/:id/children", this.intercept("read"), this.handleGetWithChildren.bind(this));
        r.get("/:id", this.intercept("read"), this.handleGetById.bind(this));
        r.put("/:id", this.intercept("update"), this.handleUpdate.bind(this));
        r.patch("/:id", this.intercept("update"), this.handleUpdate.bind(this));
        r.patch("/:id/field/:field", this.intercept("update"), this.handleUpdateField.bind(this));
        r.delete("/:id", this.intercept("delete"), this.handleDelete.bind(this));
        r.post("/:id/restore", this.intercept("update"), this.handleRestore.bind(this));
        const nestedCtrl = new NestedOpsController_1.NestedOpsController(this.nestedOpsService, this.entityName, (action, req) => this.getInterceptors(action, req));
        nestedCtrl.mount(r);
        const analysisCtrl = new AnalysisController_1.AnalysisController(this.analysisService, this.entityName);
        analysisCtrl.mount(r);
    }
    intercept(action) {
        return (req, res, next) => {
            this.applyInterceptors(action, req, res, next);
        };
    }
    isJoiOrValidationError(err) {
        return (typeof err === "object" &&
            err !== null &&
            (err.name === "ValidationError" || err.isJoi === true));
    }
    async handleAll(req, res) {
        try {
            const opts = (0, queryParser_1.parseQueryOptions)(req.query);
            const result = await this.service.all(opts);
            serverResponse_1.default.handleResponse(req, res, result, "success", `${this.entityName} records retrieved`);
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
    async handleSearch(req, res) {
        try {
            const q = String(req.query.q || req.query.query || "");
            if (!q.trim()) {
                serverResponse_1.default.handleError(req, res, "badRequest", "Search query param 'q' is required");
                return;
            }
            const opts = (0, queryParser_1.parseQueryOptions)(req.query);
            const result = await this.service.search(q, opts);
            serverResponse_1.default.handleResponse(req, res, result, "success", `Search results for "${q}"`);
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
    async handleCount(req, res) {
        try {
            const opts = (0, queryParser_1.parseQueryOptions)(req.query);
            const total = await this.service.count(opts.filter);
            serverResponse_1.default.handleResponse(req, res, { count: total }, "success", "Count retrieved");
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
    async handleFindBy(req, res) {
        try {
            const { field, value } = req.params;
            const opts = (0, queryParser_1.parseQueryOptions)(req.query);
            const result = await this.service.findBy(field, value, opts);
            serverResponse_1.default.handleResponse(req, res, result, "success", `Records where ${field}=${value}`);
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
    async handleCreate(req, res) {
        try {
            const doc = await this.service.create(req.body);
            serverResponse_1.default.handleResponse(req, res, doc, "created", `${this.entityName} created`);
        }
        catch (err) {
            if (this.isJoiOrValidationError(err)) {
                serverResponse_1.default.handleError(req, res, "badRequest", err.message, err);
            }
            else if (err.code === 11000) {
                serverResponse_1.default.handleError(req, res, "conflict", "Duplicate entry", err);
            }
            else {
                serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
            }
        }
    }
    async handleCreateMany(req, res) {
        try {
            const body = req.body;
            const items = Array.isArray(body) ? body : body.items;
            if (!Array.isArray(items)) {
                serverResponse_1.default.handleError(req, res, "badRequest", "Request body must be an array or { items: [] }");
                return;
            }
            const docs = await this.service.createMany(items);
            serverResponse_1.default.handleResponse(req, res, docs, "created", `${docs.length} ${this.entityName} records created`);
        }
        catch (err) {
            if (this.isJoiOrValidationError(err)) {
                serverResponse_1.default.handleError(req, res, "badRequest", err.message, err);
            }
            else {
                serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
            }
        }
    }
    async handleGetById(req, res) {
        try {
            const opts = (0, queryParser_1.parseQueryOptions)(req.query);
            const doc = await this.service.findById(req.params.id, opts);
            if (!doc) {
                serverResponse_1.default.handleError(req, res, "notFound", `${this.entityName} not found`);
                return;
            }
            serverResponse_1.default.handleResponse(req, res, doc, "success", `${this.entityName} retrieved`);
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
    async handleGetWithChildren(req, res) {
        try {
            const opts = (0, queryParser_1.parseQueryOptions)(req.query);
            const doc = await this.service.withChildren(req.params.id, opts);
            if (!doc) {
                serverResponse_1.default.handleError(req, res, "notFound", `${this.entityName} not found`);
                return;
            }
            serverResponse_1.default.handleResponse(req, res, doc, "success", `${this.entityName} with children retrieved`);
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
    async handleUpdate(req, res) {
        try {
            const doc = await this.service.update(req.params.id, req.body);
            if (!doc) {
                serverResponse_1.default.handleError(req, res, "notFound", `${this.entityName} not found`);
                return;
            }
            serverResponse_1.default.handleResponse(req, res, doc, "success", `${this.entityName} updated`);
        }
        catch (err) {
            if (this.isJoiOrValidationError(err)) {
                serverResponse_1.default.handleError(req, res, "badRequest", err.message, err);
            }
            else {
                serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
            }
        }
    }
    async handleUpdateField(req, res) {
        try {
            const { id, field } = req.params;
            const { value } = req.body;
            if (value === undefined) {
                serverResponse_1.default.handleError(req, res, "badRequest", "Request body must contain { value }");
                return;
            }
            const doc = await this.service.updateField(id, field, value);
            if (!doc) {
                serverResponse_1.default.handleError(req, res, "notFound", `${this.entityName} not found`);
                return;
            }
            serverResponse_1.default.handleResponse(req, res, doc, "success", `${this.entityName} field "${field}" updated`);
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
    async handleDelete(req, res) {
        try {
            const soft = req.query.hard !== "true";
            const deleted = await this.service.delete(req.params.id, { soft });
            if (!deleted) {
                serverResponse_1.default.handleError(req, res, "notFound", `${this.entityName} not found`);
                return;
            }
            serverResponse_1.default.handleResponse(req, res, null, "success", `${this.entityName} deleted`);
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
    async handleRestore(req, res) {
        try {
            const doc = await this.service.restore(req.params.id);
            if (!doc) {
                serverResponse_1.default.handleError(req, res, "notFound", `${this.entityName} not found`);
                return;
            }
            serverResponse_1.default.handleResponse(req, res, doc, "success", `${this.entityName} restored`);
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
    async handleExists(req, res) {
        try {
            const { field, value } = req.params;
            const exists = await this.service.exists({ [field]: value });
            serverResponse_1.default.handleResponse(req, res, { exists }, "success", "Existence check complete");
        }
        catch (err) {
            serverResponse_1.default.handleError(req, res, "internalServerError", undefined, err);
        }
    }
}
exports.MetaController = MetaController;
//# sourceMappingURL=MetaController.js.map