import { env } from "../config/env.js";
export const SUBMISSION_INITIALIZATION_FAILURE_EVENT = "submission_initialization_failed";
export const PROMPT_MEDIA_PREPARATION_FAILED_EVENT = "PROMPT_MEDIA_PREPARATION_FAILED";
export const ASSESSMENT_INITIALIZATION_FAILED_EVENT = "ASSESSMENT_INITIALIZATION_FAILED";
export const SUBMISSION_INITIALIZATION_ATTEMPTED_EVENT = "SUBMISSION_INITIALIZATION_ATTEMPTED";
export const SUBMISSION_INITIALIZATION_SUCCEEDED_EVENT = "SUBMISSION_INITIALIZATION_SUCCEEDED";
const ALLOWED_FAILURE_CLASSES = [
    "BANK",
    "PREPARATION",
    "TIMEOUT",
    "ELIGIBILITY_CONFLICT",
    "UNKNOWN",
];
const ALLOWED_FAILURE_REASONS = [
    "QUESTION_BANK_INCOMPLETE",
    "PROMPT_MEDIA_SIGNING_FAILED",
    "PROMPT_MEDIA_INVALID_URL",
    "PROMPT_MEDIA_MISSING_METADATA",
    "INITIALIZATION_DEADLINE_EXCEEDED",
    "ELIGIBILITY_CONFLICT",
    "UNKNOWN",
];
function isAllowed(value, allowed) {
    return allowed.includes(value);
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => value.length > 0))];
}
function safeDuration(value) {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}
function buildFailureTelemetry(event) {
    const failureClass = isAllowed(event.classification, ALLOWED_FAILURE_CLASSES)
        ? event.classification
        : "UNKNOWN";
    const internalReason = isAllowed(event.internalReason, ALLOWED_FAILURE_REASONS)
        ? event.internalReason
        : "UNKNOWN";
    return {
        event: failureClass === "PREPARATION"
            ? PROMPT_MEDIA_PREPARATION_FAILED_EVENT
            : ASSESSMENT_INITIALIZATION_FAILED_EVENT,
        sourceEvent: SUBMISSION_INITIALIZATION_FAILURE_EVENT,
        internalReason,
        requestId: event.requestId.slice(0, 128),
        failureCount: Number.isSafeInteger(event.failureCount) && event.failureCount > 0
            ? event.failureCount
            : 1,
        failedQuestionIds: uniqueStrings(event.failedQuestionIds).slice(0, 100),
        failedCategories: uniqueStrings(event.failedCategories)
            .filter((category) => category === "PART_1" || category === "PART_2" || category === "PART_3")
            .slice(0, 3),
        failureClass,
        preparationDurationMs: safeDuration(event.preparationDurationMs),
    };
}
function buildLifecycleTelemetry(event, name) {
    const duration = "preparationDurationMs" in event
        ? safeDuration(event.preparationDurationMs)
        : undefined;
    return {
        event: name,
        requestId: event.requestId.slice(0, 128),
        ...(duration === undefined ? {} : { preparationDurationMs: duration }),
    };
}
function toPushUrl(lokiUrl) {
    let parsed;
    try {
        parsed = new URL(lokiUrl);
    }
    catch {
        throw new Error("OBSERVABILITY_LOKI_URL must be an absolute HTTP(S) URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("OBSERVABILITY_LOKI_URL must use HTTP(S)");
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error("OBSERVABILITY_LOKI_URL must not contain credentials, query, or fragment");
    }
    const path = parsed.pathname.replace(/\/+$/u, "");
    if (path.endsWith("/loki/api/v1/push"))
        return parsed.toString().replace(/\/+$/u, "");
    return `${parsed.origin}${path}/loki/api/v1/push`;
}
function timestampNanoseconds() {
    return (BigInt(Date.now()) * 1000000n).toString();
}
function basicAuth(username, token) {
    return `Basic ${Buffer.from(`${username}:${token}`, "utf8").toString("base64")}`;
}
function buildPushPayload(config, line) {
    const event = line.event;
    return {
        streams: [
            {
                stream: {
                    service: config.serviceName,
                    environment: config.environment,
                    event,
                    ...("sourceEvent" in line
                        ? { source: SUBMISSION_INITIALIZATION_FAILURE_EVENT }
                        : { source: "submission_initialization" }),
                },
                values: [[timestampNanoseconds(), JSON.stringify(line)]],
            },
        ],
    };
}
function defaultDeliveryFailure(error) {
    console.error("Assessment initialization observability delivery failed", {
        error: error instanceof Error ? error.name : "UnknownError",
    });
}
function defaultConfig() {
    return {
        lokiUrl: env.OBSERVABILITY_LOKI_URL,
        username: env.OBSERVABILITY_LOKI_USERNAME,
        token: env.OBSERVABILITY_LOKI_TOKEN,
        serviceName: env.OBSERVABILITY_SERVICE_NAME ?? "fluentcheck-backend",
        environment: env.OBSERVABILITY_ENVIRONMENT ?? env.NODE_ENV,
        runbookUrl: env.OBSERVABILITY_RUNBOOK_URL ?? "",
        requestTimeoutMs: parseTimeout(env.OBSERVABILITY_TIMEOUT_MS),
    };
}
export function parseTimeout(value) {
    if (value === undefined || value.trim() === "")
        return 1_000;
    if (!/^\d+$/u.test(value)) {
        throw new Error("OBSERVABILITY_TIMEOUT_MS must be a positive integer");
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 10_000) {
        throw new Error("OBSERVABILITY_TIMEOUT_MS must be a positive integer no greater than 10000");
    }
    return parsed;
}
/**
 * Production uses Grafana Cloud Loki's JSON push endpoint. The adapter is
 * deliberately dependency-free and treats delivery as best-effort.
 */
export function createAssessmentInitializationObserver(options) {
    const pushUrl = options.lokiUrl ? toPushUrl(options.lokiUrl) : undefined;
    if ((options.username && !options.token) || (!options.username && options.token)) {
        throw new Error("OBSERVABILITY_LOKI_USERNAME and OBSERVABILITY_LOKI_TOKEN must be configured together");
    }
    const fetchImplementation = options.fetchImplementation ?? fetch;
    const onDeliveryFailure = options.onDeliveryFailure ?? defaultDeliveryFailure;
    const pending = new Set();
    const send = (line) => {
        if (!pushUrl)
            return;
        const request = (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
            try {
                const response = await fetchImplementation(pushUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(options.username && options.token
                            ? { Authorization: basicAuth(options.username, options.token) }
                            : {}),
                    },
                    body: JSON.stringify(buildPushPayload(options, line)),
                    signal: controller.signal,
                });
                if (!response.ok)
                    throw new Error(`Telemetry endpoint returned ${response.status}`);
            }
            finally {
                clearTimeout(timer);
            }
        })().catch(onDeliveryFailure);
        pending.add(request);
        void request.then(() => pending.delete(request), () => pending.delete(request));
    };
    return {
        reportFailure(event) {
            send(buildFailureTelemetry(event));
        },
        reportAttempt(event) {
            send(buildLifecycleTelemetry(event, SUBMISSION_INITIALIZATION_ATTEMPTED_EVENT));
        },
        reportSuccess(event) {
            send(buildLifecycleTelemetry(event, SUBMISSION_INITIALIZATION_SUCCEEDED_EVENT));
        },
        async flush() {
            await Promise.all([...pending]);
        },
    };
}
let defaultObserver;
function getDefaultObserver() {
    return (defaultObserver ??= createAssessmentInitializationObserver(defaultConfig()));
}
export function reportAssessmentInitializationFailure(event) {
    try {
        getDefaultObserver().reportFailure(event);
    }
    catch (error) {
        defaultDeliveryFailure(error);
    }
}
export function reportAssessmentInitializationAttempt(event) {
    try {
        getDefaultObserver().reportAttempt(event);
    }
    catch (error) {
        defaultDeliveryFailure(error);
    }
}
export function reportAssessmentInitializationSuccess(event) {
    try {
        getDefaultObserver().reportSuccess(event);
    }
    catch (error) {
        defaultDeliveryFailure(error);
    }
}
export async function flushAssessmentInitializationObservability() {
    try {
        await getDefaultObserver().flush();
    }
    catch (error) {
        defaultDeliveryFailure(error);
    }
}
export function getAssessmentInitializationObservabilityConfig() {
    const config = defaultConfig();
    if (env.NODE_ENV !== "production")
        return config;
    if (!config.lokiUrl) {
        throw new Error("OBSERVABILITY_LOKI_URL is required in production");
    }
    if (!config.username || !config.token) {
        throw new Error("OBSERVABILITY_LOKI_USERNAME and OBSERVABILITY_LOKI_TOKEN are required in production");
    }
    if (!config.runbookUrl) {
        throw new Error("OBSERVABILITY_RUNBOOK_URL is required in production");
    }
    toPushUrl(config.lokiUrl);
    if (!/^https:\/\//u.test(config.runbookUrl)) {
        throw new Error("OBSERVABILITY_RUNBOOK_URL must use HTTPS in production");
    }
    return config;
}
