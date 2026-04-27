import { CustomRequest, CustomResponse } from "../types";
import { response } from "./responseFormat";

class ServerResponse {
  handleResponse(
    req: CustomRequest,
    res: CustomResponse,
    data: unknown,
    responseStatus: string,
    message: string
  ): void {
    const responseArray = response(responseStatus);
    const responseObject = {
      isSuccess: responseArray[2],
      status: responseArray[1],
      statusCode: responseArray[0],
      data: data ?? [],
      message: message || responseArray[1],
    };
    res.status(responseArray[0]).json(responseObject);
  }

  handleError(
    req: CustomRequest,
    res: CustomResponse,
    errorType: string,
    message?: string,
    error?: Error
  ): void {
    const errorArray = response(errorType);
    const responseObject = {
      isSuccess: errorArray[2],
      status: errorArray[1],
      statusCode: errorArray[0],
      data: [],
      message: message || errorArray[1],
      errorMessage: error?.message || errorType,
    };
    res.status(errorArray[0]).json(responseObject);
  }
}

export default new ServerResponse();
