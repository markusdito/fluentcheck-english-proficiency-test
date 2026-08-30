const GOOGLE_AUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Google sign-in was cancelled. You can try again or use email and password.",
  invalid_request: "Google sign-in could not be completed. Please try again.",
  state_mismatch: "Google sign-in expired. Please try again.",
  provider_error: "Google sign-in is temporarily unavailable. Please try again later.",
  invalid_identity: "Google could not verify your account. Please try again.",
  account_conflict:
    "An account with this email already exists. Sign in with email and password instead.",
  account_inactive: "This account is no longer active. Please contact support.",
};

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "/backend-api").replace(/\/$/u, "");

export function getGoogleAuthStartPath(returnTo: "login" | "signup"): string {
  return `${API_BASE}/auth/google/start?returnTo=${returnTo}`;
}

export function getGoogleAuthErrorMessage(code: string | null): string | null {
  if (!code || !Object.prototype.hasOwnProperty.call(GOOGLE_AUTH_ERROR_MESSAGES, code)) {
    return null;
  }

  return GOOGLE_AUTH_ERROR_MESSAGES[code];
}

export function removeGoogleAuthErrorFromUrl(): void {
  if (typeof window === "undefined") return;

  const searchParams = new URLSearchParams(window.location.search);
  if (!searchParams.has("google_error")) return;

  searchParams.delete("google_error");
  const search = searchParams.toString();
  const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}
