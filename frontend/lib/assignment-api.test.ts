import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { post: mocks.post },
}));

import { assignExaminers } from "@/lib/admin-api";

describe("assignExaminers", () => {
  beforeEach(() => {
    mocks.post.mockReset();
  });

  it("posts to the admin assign endpoint and unwraps the envelope", async () => {
    const result = {
      submissionId: "submission-1",
      status: "SCORING",
      outcome: "CREATED" as const,
      assignments: [],
      assignedExaminers: [],
    };
    mocks.post.mockResolvedValue({ status: "success", data: result });

    await expect(assignExaminers("submission-1")).resolves.toEqual(result);
    expect(mocks.post).toHaveBeenCalledWith(
      "/admin/submissions/submission-1/assign",
    );
  });

  it("preserves the EXISTING outcome from the response", async () => {
    const result = {
      submissionId: "submission-1",
      status: "SCORING",
      outcome: "EXISTING" as const,
      assignments: [],
      assignedExaminers: [],
    };
    mocks.post.mockResolvedValue({ status: "success", data: result });

    const payload = await assignExaminers("submission-1");
    expect(payload.outcome).toBe("EXISTING");
  });
});
