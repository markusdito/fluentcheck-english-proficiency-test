import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: mocks.get,
  },
}));

import { fetchAdminQuestions } from "@/lib/admin-api";

describe("fetchAdminQuestions", () => {
  beforeEach(() => {
    mocks.get.mockResolvedValue({ status: "success", data: [] });
  });

  it("uses the authenticated all-orders admin question bank", async () => {
    const controller = new AbortController();

    await expect(fetchAdminQuestions(controller.signal)).resolves.toEqual([]);
    expect(mocks.get).toHaveBeenCalledWith("/questions/admin", {
      signal: controller.signal,
    });
  });
});
