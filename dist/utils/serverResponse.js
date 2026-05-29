"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const responseFormat_1 = require("./responseFormat");
class ServerResponse {
    handleResponse(req, res, data, responseStatus, message) {
        const responseArray = (0, responseFormat_1.response)(responseStatus);
        // Merge any data attached via res.attach() inside interceptors
        let finalData = data ?? [];
        if (res._attachedData && Object.keys(res._attachedData).length > 0) {
            if (finalData && typeof finalData === "object" && !Array.isArray(finalData)) {
                finalData = { ...finalData, ...res._attachedData };
            }
            else {
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
    handleError(req, res, errorType, message, error) {
        const errorArray = (0, responseFormat_1.response)(errorType);
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
exports.default = new ServerResponse();
//# sourceMappingURL=serverResponse.js.map