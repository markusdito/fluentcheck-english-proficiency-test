import { beforeAll, describe, expect, it, vi } from "vitest";

let nextConfig!: typeof import("./next.config").default;
let resolveBackendUrl!: typeof import("./next.config").resolveBackendUrl;

async function importNextConfig(backendUrl: string | undefined) {
  const previousBackendUrl = process.env.BACKEND_URL;
  if (backendUrl === undefined) {
    delete process.env.BACKEND_URL;
  } else {
    process.env.BACKEND_URL = backendUrl;
  }
  vi.resetModules();

  try {
    return await import("./next.config");
  } finally {
    if (previousBackendUrl === undefined) {
      delete process.env.BACKEND_URL;
    } else {
      process.env.BACKEND_URL = previousBackendUrl;
    }
  }
}

beforeAll(async () => {
  const config = await importNextConfig(undefined);
  nextConfig = config.default;
  resolveBackendUrl = config.resolveBackendUrl;
});

describe("Next.js backend rewrite configuration", () => {
  it("rejects non-HTTP backend destinations before building rewrites", () => {
    expect(() => resolveBackendUrl("file:///etc/passwd")).toThrow(
      /absolute HTTP\(S\) URL/,
    );
  });

  it("normalizes a valid deployment URL without changing its base path", () => {
    expect(resolveBackendUrl("https://api.example.test/assessment/")).toBe(
      "https://api.example.test/assessment",
    );
  });

  it.each([
    "https://user:password@api.example.test",
    "https://api.example.test?token=secret",
    "https://api.example.test/#fragment",
  ])("rejects unsafe URL components in %s", (rawUrl) => {
    expect(() => resolveBackendUrl(rawUrl)).toThrow(/absolute HTTP\(S\) URL/);
  });

  it("keeps the backend hostname fixed while forwarding the wildcard path", async () => {
    const rewrites = await nextConfig.rewrites?.();

    expect(rewrites).toEqual([
      {
        source: "/backend-api/:path*",
        destination: "http://localhost:5001/api/:path*",
      },
    ]);
  });

  it("uses the configured backend origin without moving the wildcard into the hostname", async () => {
    const config = await importNextConfig("https://api.example.test/assessment/");
    const rewrites = await config.default.rewrites?.();

    expect(rewrites).toEqual([
      {
        source: "/backend-api/:path*",
        destination: "https://api.example.test/assessment/api/:path*",
      },
    ]);
  });
});
