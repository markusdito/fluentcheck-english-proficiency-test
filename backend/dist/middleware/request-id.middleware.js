import { randomUUID } from "node:crypto";
const REQUEST_ID_HEADER = "X-Request-ID";
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
function isSafeRequestId(value) {
    return value !== undefined && SAFE_REQUEST_ID.test(value);
}
/**
 * Establishes one response-visible correlation ID for each request. An
 * incoming ID is accepted only when it is a bounded header-safe token.
 */
export const requestIdMiddleware = (req, res, next) => {
    const requestId = isSafeRequestId(req.header(REQUEST_ID_HEADER))
        ? req.header(REQUEST_ID_HEADER)
        : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
};
export function getRequestId(res) {
    const requestId = res.locals.requestId;
    return isSafeRequestId(requestId) ? requestId : randomUUID();
}
