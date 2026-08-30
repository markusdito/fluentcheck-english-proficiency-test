import { describe, expect, it } from "vitest";
import nextConfig, { resolveBackendUrl } from "./next.config";

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
});
