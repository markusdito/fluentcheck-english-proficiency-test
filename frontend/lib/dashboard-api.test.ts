import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDashboardStats } from "@/lib/dashboard-api";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { get: mocks.get },
}));

describe("dashboard history requests", () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue({
      data: {
        totalTests: 0,
        bestScore: null,
        submissions: [],
        pagination: { limit: 10, hasMore: false, nextCursor: null },
      },
    });
  });

  it("requests a bounded page and forwards the cursor", async () => {
    const signal = new AbortController().signal;

    await fetchDashboardStats(
      { limit: 2, cursor: "cursor/value" },
      signal,
    );

    expect(mocks.get).toHaveBeenCalledWith(
      "/submissions?limit=2&cursor=cursor%2Fvalue",
      { signal },
    );
  });
});
