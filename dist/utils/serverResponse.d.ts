import { CustomRequest, CustomResponse } from "../types";
declare class ServerResponse {
    handleResponse(req: CustomRequest, res: CustomResponse, data: unknown, responseStatus: string, message: string): void;
    handleError(req: CustomRequest, res: CustomResponse, errorType: string, message?: string, error?: Error): void;
}
declare const _default: ServerResponse;
export default _default;
//# sourceMappingURL=serverResponse.d.ts.map