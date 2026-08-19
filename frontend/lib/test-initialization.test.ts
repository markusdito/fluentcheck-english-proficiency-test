import { describe, expect, it, vi } from "vitest";
import { initializeTest } from "@/lib/test-initialization";

const mocks = vi.hoisted(() => ({
  createSubmission: vi.fn(),
  fetchTestQuestions: vi.fn(),
}));

vi.mock("@/lib/test-api", () => ({
  createSubmission: mocks.createSubmission,
  fetchTestQuestions: mocks.fetchTestQuestions,
}));

describe("initializeTest", () => {
  it("starts one submission request and one combined question request in parallel", async () => {
    let resolveSubmission!: (value: string) => void;
    let resolveQuestions!: (value: Array<Record<string, unknown>>) => void;
    mocks.createSubmission.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveSubmission = resolve;
      }),
    );
    mocks.fetchTestQuestions.mockReturnValue(
      new Promise((resolve) => {
        resolveQuestions = resolve;
      }),
    );

    const initialization = initializeTest();

    expect(mocks.createSubmission).toHaveBeenCalledTimes(1);
    expect(mocks.fetchTestQuestions).toHaveBeenCalledTimes(1);

    resolveSubmission("submission-1");
    resolveQuestions([
      {
        id: "question-1",
        category: "PART_1",
        order: 1,
        preparationSeconds: 30,
        recordingSeconds: 60,
        audioUploadStatus: "UPLOADED",
        audioUrl: "https://media.example/prompt.mp3",
        tasks: [{ id: "task-1", promptText: "Introduce yourself", order: 1 }],
      },
    ]);

    await expect(initialization).resolves.toEqual({
      submissionId: "submission-1",
      questions: [
        expect.objectContaining({
          id: "question-1",
          audioUrl: "https://media.example/prompt.mp3",
          task: "Introduce yourself",
        }),
      ],
    });
  });
});
