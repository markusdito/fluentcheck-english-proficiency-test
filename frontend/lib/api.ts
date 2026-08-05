const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001/api";

interface ApiErrorResponse {
  error?: string;
  message?: string;
  errors?: Record<string, string[]>;
}

interface RequestOptions extends RequestInit {
  redirectOn401?: boolean;
}

export class ApiError extends Error {
  public statusCode: number;
  public errors?: Record<string, string[]>;

  constructor(message: string, statusCode: number, errors?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

function buildHeaders(body?: unknown): Record<string, string> {
  const headers: Record<string, string> = {};

  // Only set Content-Type for JSON bodies, NOT for FormData
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

async function handle401() {
  if (typeof window === "undefined") return;
  // Only redirect if not already on login/signup
  const path = window.location.pathname;
  if (path !== "/login" && path !== "/signup") {
    window.location.href = "/login";
  }
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const { redirectOn401 = true, ...fetchOptions } = options;
  const body = fetchOptions.body;

  const res = await fetch(url, {
    ...fetchOptions,
    credentials: "include",
    headers: {
      ...buildHeaders(body),
      ...(fetchOptions.headers as Record<string, string> | undefined),
    },
  });

  // Handle 401 — token expired or invalid
  if (res.status === 401) {
    if (redirectOn401) await handle401();
    let body: ApiErrorResponse = {};
    try {
      body = (await res.json()) as ApiErrorResponse;
    } catch {
      // ignore parse failure
    }
    throw new ApiError(
      body.error ?? body.message ?? "Session expired. Please log in again.",
      res.status,
      body.errors
    );
  }

  if (!res.ok) {
    let body: ApiErrorResponse = {};
    try {
      body = (await res.json()) as ApiErrorResponse;
    } catch {
      // ignore parse failure
    }
    throw new ApiError(
      body.error ?? body.message ?? `Request failed with status ${res.status}`,
      res.status,
      body.errors
    );
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(endpoint: string, options?: Pick<RequestOptions, "redirectOn401">) =>
    request<T>(endpoint, { method: "GET", ...options }),

  post: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, {
      method: "POST",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, {
      method: "PUT",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: "DELETE" }),
};
