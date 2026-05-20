import { Router, NextFunction } from "express";
import {
  CustomRequest,
  CustomResponse,
  InterceptorConfig,
  InterceptorAction,
  InterceptorCallback,
  MetaEntityOptions,
  resolveIntendedFields,
} from "../types";
import { IMetaService, BaseEntityDocument } from "../types";
import serverResponse from "../utils/serverResponse";
import { parseQueryOptions } from "../utils/queryParser";
import { NestedOpsService } from "./NestedOpsService";
import { NestedOpsController } from "./NestedOpsController";

export class MetaController<T extends BaseEntityDocument = BaseEntityDocument> {
  readonly router: Router;
  readonly interceptors: InterceptorConfig[] = [];

  constructor(
    private readonly service: IMetaService<T>,
    private readonly nestedOpsService: NestedOpsService<T>,
    private readonly entityName: string,
    private readonly options: MetaEntityOptions
  ) {
    this.router = Router();
    this.registerRoutes();
  }

  addInterceptor(
    action: InterceptorAction | InterceptorAction[],
    callback: InterceptorCallback
  ): void {
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
  getInterceptors(action: InterceptorAction, req?: CustomRequest): InterceptorCallback[] {
    const intendedFields = (action === "update" && req)
      ? resolveIntendedFields(req)
      : [];

    return this.interceptors
      .filter((i) => {
        const patterns = Array.isArray(i.action) ? i.action : [i.action];
        return patterns.some((pattern) => this.matchesPattern(pattern, action, intendedFields));
      })
      .map((i) => i.callback);
  }

  private matchesPattern(
    pattern: InterceptorAction,
    action: InterceptorAction,
    intendedFields: string[]
  ): boolean {
    // "all" always fires
    if (pattern === "all") return true;

    // exact broad match: "create", "read", "delete", "update"
    if (pattern === action) return true;

    // field-targeted update: "update.fieldName" or "update.nested.path"
    if (pattern.startsWith("update.") && action === "update") {
      const targetField = pattern.slice("update.".length);
      // match if any intended field starts with or equals the target
      // e.g. pattern "update.personal_information" fires when
      // intendedFields includes "personal_information.email"
      return intendedFields.some(
        (f) => f === targetField || f.startsWith(targetField + ".")
      );
    }

    return false;
  }

  applyInterceptors(
    action: InterceptorAction,
    req: CustomRequest,
    res: CustomResponse,
    next: NextFunction
  ): void {
    const middlewares = this.getInterceptors(action, req);
    if (middlewares.length === 0) return next();

    let idx = 0;
    const run = (): void => {
      if (idx >= middlewares.length) return next();
      const mw = middlewares[idx++];
      Promise.resolve(mw(req, res, run)).catch(next);
    };
    run();
  }

  private registerRoutes(): void {
    const r = this.router;

    r.get("/all",                    this.intercept("read"),   this.handleAll.bind(this));
    r.get("/search",                 this.intercept("read"),   this.handleSearch.bind(this));
    r.get("/count",                  this.intercept("read"),   this.handleCount.bind(this));
    r.get("/by/:field/:value",       this.intercept("read"),   this.handleFindBy.bind(this));
    r.get("/exists/:field/:value",   this.intercept("read"),   this.handleExists.bind(this));
    r.post("/create",                this.intercept("create"), this.handleCreate.bind(this));
    r.post("/create/many",           this.intercept("create"), this.handleCreateMany.bind(this));
    r.get("/:id/children",           this.intercept("read"),   this.handleGetWithChildren.bind(this));
    r.get("/:id",                    this.intercept("read"),   this.handleGetById.bind(this));
    r.put("/:id",                    this.intercept("update"), this.handleUpdate.bind(this));
    r.patch("/:id",                  this.intercept("update"), this.handleUpdate.bind(this));
    r.patch("/:id/field/:field",     this.intercept("update"), this.handleUpdateField.bind(this));
    r.delete("/:id",                 this.intercept("delete"), this.handleDelete.bind(this));
    r.post("/:id/restore",           this.intercept("update"), this.handleRestore.bind(this));

    const nestedCtrl = new NestedOpsController<T>(
      this.nestedOpsService,
      this.entityName,
      (action, req) => this.getInterceptors(action as InterceptorAction, req)
    );
    nestedCtrl.mount(r);
  }

  private intercept(action: InterceptorAction) {
    return (req: CustomRequest, res: CustomResponse, next: NextFunction): void => {
      this.applyInterceptors(action, req, res, next);
    };
  }

  private isJoiOrValidationError(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      ((err as any).name === "ValidationError" || (err as any).isJoi === true)
    );
  }

  private async handleAll(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const opts = parseQueryOptions(req.query as Record<string, unknown>);
      const result = await this.service.all(opts);
      serverResponse.handleResponse(req, res, result, "success", `${this.entityName} records retrieved`);
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }

  private async handleSearch(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const q = String(req.query.q || req.query.query || "");
      if (!q.trim()) {
        serverResponse.handleError(req, res, "badRequest", "Search query param 'q' is required");
        return;
      }
      const opts = parseQueryOptions(req.query as Record<string, unknown>);
      const result = await this.service.search(q, opts);
      serverResponse.handleResponse(req, res, result, "success", `Search results for "${q}"`);
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }

  private async handleCount(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const opts = parseQueryOptions(req.query as Record<string, unknown>);
      const total = await this.service.count(opts.filter);
      serverResponse.handleResponse(req, res, { count: total }, "success", "Count retrieved");
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }

  private async handleFindBy(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const { field, value } = req.params;
      const opts = parseQueryOptions(req.query as Record<string, unknown>);
      const result = await this.service.findBy(field, value, opts);
      serverResponse.handleResponse(req, res, result, "success", `Records where ${field}=${value}`);
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }

  private async handleCreate(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const doc = await this.service.create(req.body);
      serverResponse.handleResponse(req, res, doc, "created", `${this.entityName} created`);
    } catch (err: any) {
      if (this.isJoiOrValidationError(err)) {
        serverResponse.handleError(req, res, "badRequest", err.message, err as Error);
      } else if (err.code === 11000) {
        serverResponse.handleError(req, res, "conflict", "Duplicate entry", err as Error);
      } else {
        serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
      }
    }
  }

  private async handleCreateMany(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const body = req.body;
      const items = Array.isArray(body) ? body : body.items;
      if (!Array.isArray(items)) {
        serverResponse.handleError(req, res, "badRequest", "Request body must be an array or { items: [] }");
        return;
      }
      const docs = await this.service.createMany(items);
      serverResponse.handleResponse(req, res, docs, "created", `${docs.length} ${this.entityName} records created`);
    } catch (err: any) {
      if (this.isJoiOrValidationError(err)) {
        serverResponse.handleError(req, res, "badRequest", err.message, err as Error);
      } else {
        serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
      }
    }
  }

  private async handleGetById(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const opts = parseQueryOptions(req.query as Record<string, unknown>);
      const doc = await this.service.findById(req.params.id, opts);
      if (!doc) {
        serverResponse.handleError(req, res, "notFound", `${this.entityName} not found`);
        return;
      }
      serverResponse.handleResponse(req, res, doc, "success", `${this.entityName} retrieved`);
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }

  private async handleGetWithChildren(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const opts = parseQueryOptions(req.query as Record<string, unknown>);
      const doc = await this.service.withChildren(req.params.id, opts);
      if (!doc) {
        serverResponse.handleError(req, res, "notFound", `${this.entityName} not found`);
        return;
      }
      serverResponse.handleResponse(req, res, doc, "success", `${this.entityName} with children retrieved`);
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }

  private async handleUpdate(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const doc = await this.service.update(req.params.id, req.body);
      if (!doc) {
        serverResponse.handleError(req, res, "notFound", `${this.entityName} not found`);
        return;
      }
      serverResponse.handleResponse(req, res, doc, "success", `${this.entityName} updated`);
    } catch (err: any) {
      if (this.isJoiOrValidationError(err)) {
        serverResponse.handleError(req, res, "badRequest", err.message, err as Error);
      } else {
        serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
      }
    }
  }

  private async handleUpdateField(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const { id, field } = req.params;
      const { value } = req.body;
      if (value === undefined) {
        serverResponse.handleError(req, res, "badRequest", "Request body must contain { value }");
        return;
      }
      const doc = await this.service.updateField(id, field, value);
      if (!doc) {
        serverResponse.handleError(req, res, "notFound", `${this.entityName} not found`);
        return;
      }
      serverResponse.handleResponse(req, res, doc, "success", `${this.entityName} field "${field}" updated`);
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }

  private async handleDelete(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const soft = req.query.hard !== "true";
      const deleted = await this.service.delete(req.params.id, { soft });
      if (!deleted) {
        serverResponse.handleError(req, res, "notFound", `${this.entityName} not found`);
        return;
      }
      serverResponse.handleResponse(req, res, null, "success", `${this.entityName} deleted`);
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }

  private async handleRestore(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const doc = await this.service.restore(req.params.id);
      if (!doc) {
        serverResponse.handleError(req, res, "notFound", `${this.entityName} not found`);
        return;
      }
      serverResponse.handleResponse(req, res, doc, "success", `${this.entityName} restored`);
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }

  private async handleExists(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const { field, value } = req.params;
      const exists = await this.service.exists({ [field]: value });
      serverResponse.handleResponse(req, res, { exists }, "success", "Existence check complete");
    } catch (err) {
      serverResponse.handleError(req, res, "internalServerError", undefined, err as Error);
    }
  }
}
