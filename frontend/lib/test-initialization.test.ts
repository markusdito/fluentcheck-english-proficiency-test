import { describe, expect, it, vi } from "vitest";
import { initializeTest } from "@/lib/test-initialization";

const mocks = vi.hoisted(() => ({
  initializeSubmission: vi.fn(),
}));

vi.mock("@/lib/test-api", () => ({
  initializeSubmission: mocks.initializeSubmission,
}));

describe("initializeTest", () => {
  it("uses one authoritative manifest-backed initialization request", async () => {
    mocks.initializeSubmission.mockResolvedValue({
      submissionId: "submission-1",
      status: "IN_PROGRESS",
      manifestId: "manifest-1",
      version: 1,
      entries: [{
        id: "entry-1",
        category: "PART_1",
        deliveryPosition: 1,
        preparationSeconds: 30,
        recordingSeconds: 60,
        promptMediaMimeType: "audio/webm",
        promptMediaSizeBytes: 42,
        promptMediaUrl: "https://media.example/prompt.mp3",
        tasks: [{ order: 1, promptText: "Introduce yourself" }],
      }],
    });

    const initialization = await initializeTest();

    expect(mocks.initializeSubmission).toHaveBeenCalledTimes(1);

    expect(initialization).toEqual({
      submissionId: "submission-1",
      questions: [
        expect.objectContaining({
          id: "entry-1",
          audioUrl: "https://media.example/prompt.mp3",
          task: "Introduce yourself",
        }),
      ],
    });
  });
});
