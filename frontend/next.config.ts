import type { NextConfig } from "next";

const DEFAULT_BACKEND_URL = "http://localhost:5001";
const INVALID_BACKEND_URL_MESSAGE =
  "BACKEND_URL must be an absolute HTTP(S) URL without credentials, query, or fragment";

export function resolveBackendUrl(rawUrl: string | undefined): string {
  const candidate = rawUrl ?? DEFAULT_BACKEND_URL;
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error(INVALID_BACKEND_URL_MESSAGE);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(INVALID_BACKEND_URL_MESSAGE);
  }

  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

// BACKEND_URL is deployment configuration, not request data. The rewrite's
// only wildcard remains in the backend path, so requests cannot choose a host.
const backendUrl = resolveBackendUrl(process.env.BACKEND_URL);

const nextConfig: NextConfig = {
  allowedDevOrigins: ["illusion-extinct-unripe.ngrok-free.dev"],
  async rewrites() {
    return [
      {
        source: "/backend-api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
