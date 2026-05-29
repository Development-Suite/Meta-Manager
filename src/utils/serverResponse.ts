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

    // Merge any data attached via res.attach() inside interceptors
    let finalData: unknown = data ?? [];
    if (res._attachedData && Object.keys(res._attachedData).length > 0) {
      if (finalData && typeof finalData === "object" && !Array.isArray(finalData)) {
        finalData = { ...(finalData as Record<string, unknown>), ...res._attachedData };
      } else {
        // data is an array or primitive — wrap in an envelope
        finalData = { data: finalData, ...res._attachedData };
      }
    }

    const responseObject = {
      isSuccess: responseArray[2],
      status: responseArray[1],
      statusCode: responseArray[0],
      data: finalData,
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
