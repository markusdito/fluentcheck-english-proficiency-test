import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";
import { generateToken } from "../utils/jwt.js";
import { GoogleAccountResolutionError, databaseGoogleOAuthStateStore, googleIdentityFromTokenPayload, resolveGoogleAccount, } from "../service/googleAuth.service.js";
const OAUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1_000;
const OAUTH_COOKIE_NAMES = {
    state: "google_oauth_state",
    verifier: "google_oauth_verifier",
    returnTo: "google_oauth_return_to",
};
function randomBase64Url(bytes) {
    return randomBytes(bytes).toString("base64url");
}
function codeChallenge(verifier) {
    return createHash("sha256").update(verifier).digest("base64url");
}
function returnToValue(value) {
    return value === "login" || value === "signup" ? value : undefined;
}
function queryValue(request, key) {
    const value = request.query[key];
    return typeof value === "string" ? value : undefined;
}
function oauthCookiePath(redirectUri) {
    const pathname = new URL(redirectUri).pathname;
    return pathname.slice(0, -"/callback".length);
}
function oauthCookieOptions(cookiePath) {
    return {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "lax",
        path: cookiePath,
        maxAge: OAUTH_COOKIE_MAX_AGE_MS,
    };
}
function clearOAuthCookies(response, cookiePath) {
    const options = oauthCookieOptions(cookiePath);
    for (const name of Object.values(OAUTH_COOKIE_NAMES)) {
        response.clearCookie(name, {
            httpOnly: options.httpOnly,
            secure: options.secure,
            sameSite: options.sameSite,
            path: options.path,
        });
    }
}
function frontendRedirect(frontendUrl, page, error) {
    let url;
    try {
        url = new URL(frontendUrl);
    }
    catch {
        throw new Error("FRONTEND_URL must be an absolute URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("FRONTEND_URL must use HTTP or HTTPS");
    }
    if (url.username || url.password) {
        throw new Error("FRONTEND_URL must not contain credentials");
    }
    if (env.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error("FRONTEND_URL must use HTTPS in production");
    }
    url.pathname = `/${page}`;
    url.search = "";
    url.hash = "";
    if (error)
        url.searchParams.set("google_error", error);
    return url.toString();
}
function redirectFailure(response, frontendUrl, cookiePath, returnTo, error) {
    clearOAuthCookies(response, cookiePath);
    response.redirect(frontendRedirect(frontendUrl, returnTo, error));
}
function mapFailureCode(error) {
    if (error instanceof GoogleAccountResolutionError)
        return error.code;
    return "provider_error";
}
/**
 * Creates provider-owned HTTP handlers while keeping account resolution in
 * the service layer and the provider client injectable for tests.
 */
export function createGoogleAuthHandlers(config, dependencies = {}) {
    const client = dependencies.client ??
        new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
    const frontendUrl = dependencies.frontendUrl ?? env.FRONTEND_URL;
    const cookiePath = oauthCookiePath(config.redirectUri);
    frontendRedirect(frontendUrl, "login");
    const resolveAccount = dependencies.resolveAccount ?? resolveGoogleAccount;
    const stateStore = dependencies.stateStore ?? databaseGoogleOAuthStateStore;
    const issueSession = dependencies.issueSession ??
        ((userId, response) => generateToken(userId, response));
    const now = dependencies.now ?? (() => Date.now());
    const start = async (request, response) => {
        const returnTo = returnToValue(queryValue(request, "returnTo"));
        if (!returnTo) {
            redirectFailure(response, frontendUrl, cookiePath, "login", "invalid_request");
            return;
        }
        const state = randomBase64Url(32);
        const verifier = randomBase64Url(32);
        const cookieOptions = oauthCookieOptions(cookiePath);
        try {
            await stateStore.create(state, returnTo, new Date(now() + OAUTH_COOKIE_MAX_AGE_MS));
            response.cookie(OAUTH_COOKIE_NAMES.state, state, cookieOptions);
            response.cookie(OAUTH_COOKIE_NAMES.verifier, verifier, cookieOptions);
            response.cookie(OAUTH_COOKIE_NAMES.returnTo, returnTo, cookieOptions);
            const authorizationUrl = client.generateAuthUrl({
                access_type: "online",
                scope: ["openid", "email", "profile"],
                state,
                redirect_uri: config.redirectUri,
                code_challenge: codeChallenge(verifier),
                code_challenge_method: "S256",
            });
            response.redirect(authorizationUrl);
        }
        catch {
            await stateStore.consume(state, returnTo, new Date(now())).catch(() => false);
            redirectFailure(response, frontendUrl, cookiePath, returnTo, "provider_error");
        }
    };
    const callback = async (request, response) => {
        const savedReturnTo = returnToValue(request.cookies?.[OAUTH_COOKIE_NAMES.returnTo]);
        const returnTo = savedReturnTo ?? "login";
        const fail = (error) => redirectFailure(response, frontendUrl, cookiePath, returnTo, error);
        try {
            if (!savedReturnTo) {
                fail("invalid_request");
                return;
            }
            const code = queryValue(request, "code");
            const state = queryValue(request, "state");
            const savedState = request.cookies?.[OAUTH_COOKIE_NAMES.state];
            const verifier = request.cookies?.[OAUTH_COOKIE_NAMES.verifier];
            if (!state || !savedState || !verifier) {
                fail("invalid_request");
                return;
            }
            const expected = Buffer.from(savedState, "utf8");
            const received = Buffer.from(state, "utf8");
            if (expected.length !== received.length ||
                !timingSafeEqual(expected, received)) {
                fail("state_mismatch");
                return;
            }
            let consumed;
            try {
                consumed = await stateStore.consume(savedState, savedReturnTo, new Date(now()));
            }
            catch {
                fail("provider_error");
                return;
            }
            if (!consumed) {
                fail("state_mismatch");
                return;
            }
            const providerError = queryValue(request, "error");
            if (providerError) {
                fail(providerError === "access_denied" ? "cancelled" : "provider_error");
                return;
            }
            if (!code) {
                fail("invalid_request");
                return;
            }
            let tokens;
            try {
                ({ tokens } = await client.getToken({
                    code,
                    codeVerifier: verifier,
                    redirect_uri: config.redirectUri,
                }));
            }
            catch {
                fail("provider_error");
                return;
            }
            if (!tokens.id_token) {
                fail("invalid_identity");
                return;
            }
            let payload;
            try {
                const ticket = await client.verifyIdToken({
                    idToken: tokens.id_token,
                    audience: config.clientId,
                });
                payload = ticket.getPayload();
            }
            catch {
                fail("invalid_identity");
                return;
            }
            const identity = googleIdentityFromTokenPayload(payload, config.clientId, now);
            const account = await resolveAccount(identity);
            await issueSession(account.id, response);
            clearOAuthCookies(response, cookiePath);
            response.redirect(frontendRedirect(frontendUrl, "dashboard"));
        }
        catch (error) {
            fail(mapFailureCode(error));
        }
    };
    return { start, callback };
}
