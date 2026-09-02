import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTest } from "@/lib/test-initialization";

const mocks = vi.hoisted(() => ({
  initializeSubmission: vi.fn(),
  resumeActiveSubmission: vi.fn(),
}));

vi.mock("@/lib/test-api", () => ({
  initializeSubmission: mocks.initializeSubmission,
  resumeActiveSubmission: mocks.resumeActiveSubmission,
}));

describe("initializeTest", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

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

    const initialization = await initializeTest("student-1");

    expect(mocks.initializeSubmission).toHaveBeenCalledTimes(1);
    expect(mocks.initializeSubmission).toHaveBeenCalledWith(expect.any(String));
    expect(JSON.parse(window.sessionStorage.getItem("fluentcheck.assessment-start-key")!)).toEqual({
      studentId: "student-1",
      key: expect.any(String),
    });

    expect(initialization).toEqual({
      submissionId: "submission-1",
      uploadedEntryIds: [],
      questions: [
        expect.objectContaining({
          id: "entry-1",
          audioUrl: "https://media.example/prompt.mp3",
          task: "Introduce yourself",
        }),
      ],
    });
  });

  it("resumes the active manifest when initialization reports a conflict", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.initializeSubmission.mockRejectedValueOnce(new ApiError("An active Submission already exists", 409));
    mocks.resumeActiveSubmission.mockResolvedValueOnce({
      submissionId: "resumed-submission",
      status: "IN_PROGRESS",
      manifestId: "manifest-2",
      version: 1,
      entries: [],
    });

    const result = await initializeTest("student-1");

    expect(mocks.resumeActiveSubmission).toHaveBeenCalledOnce();
    expect(result.submissionId).toBe("resumed-submission");
  });

  it("preserves a retryable resume failure instead of the stale conflict", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.initializeSubmission.mockRejectedValueOnce(new ApiError("An active Submission already exists", 409));
    const unavailable = new ApiError(
      "Assessment unavailable",
      503,
      undefined,
      "ASSESSMENT_UNAVAILABLE",
      true,
    );
    mocks.resumeActiveSubmission.mockRejectedValueOnce(unavailable);

    await expect(initializeTest("student-1")).rejects.toBe(unavailable);
  });

  it("rotates a stale start intent once after the server closes its Submission", async () => {
    const { ApiError } = await import("@/lib/api");
    const staleKey = JSON.stringify({ studentId: "student-1", key: "closed-key" });
    window.sessionStorage.setItem("fluentcheck.assessment-start-key", staleKey);
    mocks.initializeSubmission
      .mockRejectedValueOnce(
        new ApiError("Assessment start intent is closed", 409, undefined, "ASSESSMENT_START_INTENT_CLOSED"),
      )
      .mockResolvedValueOnce({
        submissionId: "new-submission",
        status: "IN_PROGRESS",
        manifestId: "manifest-new",
        version: 1,
        entries: [],
      });

    const result = await initializeTest("student-1");

    expect(result.submissionId).toBe("new-submission");
    expect(mocks.initializeSubmission).toHaveBeenCalledTimes(2);
    expect(mocks.initializeSubmission.mock.calls[0][0]).toBe("closed-key");
    expect(mocks.initializeSubmission.mock.calls[1][0]).not.toBe("closed-key");
    expect(JSON.parse(window.sessionStorage.getItem("fluentcheck.assessment-start-key")!)).toEqual({
      studentId: "student-1",
      key: mocks.initializeSubmission.mock.calls[1][0],
    });
  });

  it("discards a key left by another signed-in student before initialization", async () => {
    window.sessionStorage.setItem(
      "fluentcheck.assessment-start-key",
      JSON.stringify({ studentId: "student-2", key: "foreign-key" }),
    );
    mocks.initializeSubmission.mockResolvedValueOnce({
      submissionId: "student-one-submission",
      status: "IN_PROGRESS",
      manifestId: "manifest-1",
      version: 1,
      entries: [],
    });

    await initializeTest("student-1");

    expect(mocks.initializeSubmission).toHaveBeenCalledWith(expect.not.stringMatching(/^foreign-key$/));
  });
});
