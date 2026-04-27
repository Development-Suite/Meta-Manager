import { ResponseFormat } from "../types";

function responseFormats(format: string): [number, string, boolean] {
  const formats: ResponseFormat = {
    success: [200, "OK", true],
    created: [201, "Created", true],
    noContent: [204, "No Content", true],
    badRequest: [400, "Bad Request", false],
    unauthorized: [401, "Unauthorized", false],
    forbidden: [403, "Forbidden", false],
    notFound: [404, "Not Found", false],
    methodNotAllowed: [405, "Method Not Allowed", false],
    conflict: [409, "Conflict", false],
    unprocessable: [422, "Unprocessable Entity", false],
    internalServerError: [500, "Internal Server Error", false],
    badGateway: [502, "Bad Gateway", false],
    serviceUnavailable: [503, "Service Unavailable", false],
  };
  return formats[format] || formats["internalServerError"];
}

export const response = responseFormats;
