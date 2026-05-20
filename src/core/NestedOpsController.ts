import { Router } from "express";
import { CustomRequest, CustomResponse, InterceptorCallback } from "../types";
import { NestedOpsService } from "./NestedOpsService";
import { BaseEntityDocument } from "../types";
import serverResponse from "../utils/serverResponse";

export class NestedOpsController<T extends BaseEntityDocument = BaseEntityDocument> {
  constructor(
    private readonly service: NestedOpsService<T>,
    private readonly entityName: string,
    private readonly getInterceptors: (action: string, req?: CustomRequest) => InterceptorCallback[]
  ) {}

  mount(router: Router): void {
    // Single nested operation
    // PATCH /:id/nested
    router.patch(
      "/:id/nested",
      this.runInterceptors("update"),
      this.handleSingle.bind(this)
    );

    // Multiple nested operations in one request
    // PATCH /:id/nested/batch
    router.patch(
      "/:id/nested/batch",
      this.runInterceptors("update"),
      this.handleBatch.bind(this)
    );
  }

  private runInterceptors(action: string) {
    return (req: CustomRequest, res: CustomResponse, next: () => void): void => {
      const middlewares = this.getInterceptors(action, req);
      if (middlewares.length === 0) return next();
      let idx = 0;
      const run = (): void => {
        if (idx >= middlewares.length) return next();
        const mw = middlewares[idx++];
        Promise.resolve(mw(req, res, run)).catch(next as any);
      };
      run();
    };
  }

  private async handleSingle(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const { id } = req.params;
      const { field, operation, value } = req.body;

      if (!field || !operation) {
        serverResponse.handleError(req, res, "badRequest", "Body must contain: field, operation, value");
        return;
      }

      const result = await this.service.apply(id, { field, operation, value });

      if (!result.updated) {
        serverResponse.handleError(req, res, "notFound", `${this.entityName} not found`);
        return;
      }

      serverResponse.handleResponse(req, res, result.updated, "success", `${this.entityName} nested field updated`);
    } catch (err: any) {
      if (err.message?.includes("requires") || err.message?.includes("Unknown")) {
        serverResponse.handleError(req, res, "badRequest", err.message, err);
      } else {
        serverResponse.handleError(req, res, "internalServerError", undefined, err);
      }
    }
  }

  private async handleBatch(req: CustomRequest, res: CustomResponse): Promise<void> {
    try {
      const { id } = req.params;
      const ops = Array.isArray(req.body) ? req.body : req.body?.ops;

      if (!Array.isArray(ops) || ops.length === 0) {
        serverResponse.handleError(req, res, "badRequest", "Body must be an array of operations, or { ops: [...] }");
        return;
      }

      for (let i = 0; i < ops.length; i++) {
        if (!ops[i].field || !ops[i].operation) {
          serverResponse.handleError(req, res, "badRequest", `Operation at index ${i} is missing field or operation`);
          return;
        }
      }

      const result = await this.service.applyMany(id, ops);

      if (!result.updated) {
        serverResponse.handleError(req, res, "notFound", `${this.entityName} not found`);
        return;
      }

      serverResponse.handleResponse(req, res, result.updated, "success", `${this.entityName} nested fields updated`);
    } catch (err: any) {
      if (err.message?.includes("requires") || err.message?.includes("Unknown")) {
        serverResponse.handleError(req, res, "badRequest", err.message, err);
      } else {
        serverResponse.handleError(req, res, "internalServerError", undefined, err);
      }
    }
  }
}
