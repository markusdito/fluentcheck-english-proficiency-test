const DEFAULT_REMEMBERED_SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_REMEMBERED_SESSION_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
function parseRememberedSessionSeconds(value) {
    if (value === undefined)
        return DEFAULT_REMEMBERED_SESSION_SECONDS;
    if (!/^\d+$/u.test(value)) {
        throw new Error("REMEMBERED_SESSION_SECONDS must be a positive integer");
    }
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) ||
        seconds <= 0 ||
        seconds > MAX_REMEMBERED_SESSION_SECONDS) {
        throw new Error("REMEMBERED_SESSION_SECONDS must be a positive integer");
    }
    return seconds;
}
export const env = {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "1h",
    REMEMBERED_SESSION_SECONDS: parseRememberedSessionSeconds(process.env.REMEMBERED_SESSION_SECONDS),
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    RETENTION_CLEANUP_ENABLED: process.env.RETENTION_CLEANUP_ENABLED === "1",
    IPAYMU_VA_NUMBER: process.env.IPAYMU_VA_NUMBER,
    IPAYMU_API_KEY: process.env.IPAYMU_API_KEY,
    IPAYMU_ENV: process.env.IPAYMU_ENV ?? "sandbox",
    IPAYMU_NOTIFY_URL: process.env.IPAYMU_NOTIFY_URL,
    IPAYMU_PAYMENT_AMOUNT: process.env.IPAYMU_PAYMENT_AMOUNT ?? "150000",
    IPAYMU_CURRENCY: process.env.IPAYMU_CURRENCY ?? "IDR",
    FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:3000",
    RATE_LIMIT_HMAC_SECRET: process.env.RATE_LIMIT_HMAC_SECRET,
    RATE_LIMIT_TRUST_PROXY: process.env.RATE_LIMIT_TRUST_PROXY,
    RATE_LIMIT_IPV6_SUBNET: process.env.RATE_LIMIT_IPV6_SUBNET,
    RATE_LIMIT_TOPOLOGY: process.env.RATE_LIMIT_TOPOLOGY,
    RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE,
    RATE_LIMIT_STORE_TIMEOUT_MS: process.env.RATE_LIMIT_STORE_TIMEOUT_MS,
    RATE_LIMIT_SHARED_STORE_URL: process.env.RATE_LIMIT_SHARED_STORE_URL,
    OBSERVABILITY_LOKI_URL: process.env.OBSERVABILITY_LOKI_URL,
    OBSERVABILITY_LOKI_USERNAME: process.env.OBSERVABILITY_LOKI_USERNAME,
    OBSERVABILITY_LOKI_TOKEN: process.env.OBSERVABILITY_LOKI_TOKEN,
    OBSERVABILITY_SERVICE_NAME: process.env.OBSERVABILITY_SERVICE_NAME,
    OBSERVABILITY_ENVIRONMENT: process.env.OBSERVABILITY_ENVIRONMENT,
    OBSERVABILITY_RUNBOOK_URL: process.env.OBSERVABILITY_RUNBOOK_URL,
    OBSERVABILITY_TIMEOUT_MS: process.env.OBSERVABILITY_TIMEOUT_MS,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
};
const GOOGLE_CALLBACK_PATH = "/backend-api/auth/google/callback";
/**
 * Returns no configuration when Google OAuth is intentionally disabled, but
 * rejects partial or unsafe configuration before production starts.
 */
export function getGoogleOAuthConfig(input = {
    nodeEnv: env.NODE_ENV,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
}) {
    const values = [input.clientId, input.clientSecret, input.redirectUri];
    if (values.every((value) => value === undefined || value.trim() === "")) {
        if (input.nodeEnv === "production") {
            throw new Error("Google OAuth requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in production");
        }
        return undefined;
    }
    if (values.some((value) => !value || value.trim() === "")) {
        throw new Error("Google OAuth requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI together");
    }
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    const redirectUri = input.redirectUri.trim();
    if (/\s/u.test(clientId)) {
        throw new Error("Google OAuth client ID must not contain whitespace");
    }
    if (!/^[0-9]+(?:-[A-Za-z0-9_-]+)?\.apps\.googleusercontent\.com$/u.test(clientId)) {
        throw new Error("Google OAuth client ID has an invalid format");
    }
    if (/\s/u.test(clientSecret)) {
        throw new Error("Google OAuth client secret must not contain whitespace");
    }
    let parsedRedirectUri;
    try {
        parsedRedirectUri = new URL(redirectUri);
    }
    catch {
        throw new Error("Google OAuth redirect URI must be an absolute URL");
    }
    if (parsedRedirectUri.protocol !== "https:" &&
        !(input.nodeEnv !== "production" && parsedRedirectUri.protocol === "http:")) {
        throw new Error("Google OAuth redirect URI must use HTTPS in production");
    }
    if (parsedRedirectUri.username ||
        parsedRedirectUri.password ||
        parsedRedirectUri.search ||
        parsedRedirectUri.hash ||
        parsedRedirectUri.pathname !== GOOGLE_CALLBACK_PATH) {
        throw new Error(`Google OAuth redirect URI must use the exact ${GOOGLE_CALLBACK_PATH} callback path without credentials or query parameters`);
    }
    let parsedFrontendUrl;
    try {
        parsedFrontendUrl = new URL(input.frontendUrl ?? env.FRONTEND_URL);
    }
    catch {
        throw new Error("FRONTEND_URL must be an absolute URL");
    }
    if (parsedRedirectUri.origin !== parsedFrontendUrl.origin) {
        throw new Error("Google OAuth redirect URI must use the FRONTEND_URL origin for the same-origin callback");
    }
    return Object.freeze({ clientId, clientSecret, redirectUri });
}
