import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestPage from "./page";

const mocks = vi.hoisted(() => ({
  completeSubmission: vi.fn(),
  confirmUpload: vi.fn(),
  getPresignedUrl: vi.fn(),
  initializeTest: vi.fn(),
  requestPermissions: vi.fn(),
  abandonSubmission: vi.fn(),
  resetRecording: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  stopStream: vi.fn(),
  uploadToR2: vi.fn(),
  assessmentStart: {
    audioDevices: [],
    audioError: null,
    audioErrorCode: null,
    isAudioReady: true,
    isLoading: false,
    isMicActive: false,
    isVideoReady: true,
    mediaReady: true,
    micLevel: 0,
    monitorError: null,
    requestPermissions: vi.fn(),
    sessionError: null,
    sessionPending: false,
    student: null,
    studentId: "student-1",
    videoDevices: [],
    videoError: null,
    videoErrorCode: null,
  },
  recording: {
    blob: null as Blob | null,
    duration: 0,
    error: null as string | null,
  },
  stream: { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream,
  countdown: {
    formatted: "0:00",
    isComplete: false,
    isRunning: false,
    pause: vi.fn(),
    reset: vi.fn(),
    seconds: 0,
    start: vi.fn(),
  },
}));

vi.mock("@/components/providers/AssessmentStartProvider", () => ({
  useAssessmentStart: () => ({
    ...mocks.assessmentStart,
    stream: mocks.stream,
    requestPermissions: mocks.requestPermissions,
    stopStream: mocks.stopStream,
  }),
}));

vi.mock("@/hooks/useRecording", () => ({
  useRecording: () => ({
    ...mocks.recording,
    startRecording: mocks.startRecording,
    stopRecording: mocks.stopRecording,
    resetRecording: mocks.resetRecording,
  }),
}));

vi.mock("@/hooks/useCountdown", () => ({
  useCountdown: () => mocks.countdown,
}));

vi.mock("@/lib/test-initialization", () => ({
  initializeTest: mocks.initializeTest,
}));

vi.mock("@/lib/test-api", () => ({
  abandonSubmission: mocks.abandonSubmission,
  completeSubmission: mocks.completeSubmission,
}));

vi.mock("@/lib/upload-api", () => ({
  getPresignedUrl: mocks.getPresignedUrl,
  uploadToR2: mocks.uploadToR2,
  confirmUpload: mocks.confirmUpload,
}));

vi.mock("@/components/test/PromptDisplay", () => ({
  PromptDisplay: ({ questionNumber, totalQuestions }: { questionNumber: number; totalQuestions: number }) => (
    <div>Question {questionNumber} of {totalQuestions}</div>
  ),
}));

vi.mock("@/components/test/WebcamPreview", () => ({
  WebcamPreview: () => <div>webcam</div>,
}));

vi.mock("@/components/test/RecordingTimer", () => ({
  RecordingTimer: ({ elapsed }: { elapsed: number }) => <div>elapsed {elapsed}</div>,
}));

const questions = ["PART_1", "PART_2", "PART_3"].map((category, index) => ({
  id: `entry-${index + 1}`,
  audioUrl: null,
  tasks: [`Prompt ${index + 1}`],
  task: `Prompt ${index + 1}`,
  prepTime: 0,
  recordingDuration: 60,
  order: index + 1,
  category,
}));

const params = Promise.resolve({ testId: "test-1" });
type PageView = ReturnType<typeof render>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderPage() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={<div>loading page</div>}>
        <TestPage params={params} />
      </Suspense>,
    );
    await params;
  });
  return view;
}

async function setFinalizedBlob(view: PageView, duration = 12) {
  mocks.recording.blob = new Blob(["recorded video"], { type: "video/webm" });
  mocks.recording.duration = duration;
  await act(async () => {
    view.rerender(
      <Suspense fallback={<div>loading page</div>}>
        <TestPage params={params} />
      </Suspense>,
    );
    await params;
  });
}

async function uploadCurrentQuestion(view: PageView) {
  await setFinalizedBlob(view);
  await waitFor(() => expect(mocks.getPresignedUrl).toHaveBeenCalled());
  await waitFor(() => expect(mocks.uploadToR2).toHaveBeenCalled());
  await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: /next question|finish test/i })).toBeEnabled());
}

describe("TestPage recording and upload workflow", () => {
  beforeEach(() => {
    mocks.completeSubmission.mockResolvedValue(undefined);
    mocks.confirmUpload.mockResolvedValue(undefined);
    mocks.getPresignedUrl.mockResolvedValue({
      answerId: "answer-1",
      presignedUrl: "https://storage.example/upload",
      storageKey: "answers/answer-1.webm",
    });
    mocks.initializeTest.mockResolvedValue({
      submissionId: "submission-1",
      questions,
      uploadedEntryIds: [],
    });
    mocks.requestPermissions.mockResolvedValue(true);
    Object.assign(mocks.assessmentStart, {
      isAudioReady: true,
      isVideoReady: true,
      mediaReady: true,
      sessionError: null,
      sessionPending: false,
      studentId: "student-1",
    });
    mocks.uploadToR2.mockResolvedValue(undefined);
    mocks.recording.blob = null;
    mocks.recording.duration = 0;
    mocks.recording.error = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Next disabled until the asynchronous stop produces and verifies a non-empty blob", async () => {
    const user = userEvent.setup();
    const view = await renderPage();
    await screen.findByRole("button", { name: "Start recording" });

    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await user.click(screen.getByRole("button", { name: "Stop answering" }));
    expect(screen.getByRole("button", { name: "Next question" })).toBeDisabled();
    expect(mocks.getPresignedUrl).not.toHaveBeenCalled();

    const confirm = deferred<void>();
    mocks.confirmUpload.mockReturnValueOnce(confirm.promise);
    await setFinalizedBlob(view);

    await waitFor(() => expect(mocks.getPresignedUrl).toHaveBeenCalledWith(
      "submission-1",
      "entry-1",
      "video/webm",
    ));
    await waitFor(() => expect(mocks.uploadToR2).toHaveBeenCalledWith(
      "https://storage.example/upload",
      mocks.recording.blob,
    ));
    expect(screen.getByRole("button", { name: "Next question" })).toBeDisabled();
    expect(mocks.completeSubmission).not.toHaveBeenCalled();

    confirm.resolve(undefined);
    await waitFor(() => expect(screen.getByRole("button", { name: "Next question" })).toBeEnabled());
  });

  it("blocks navigation while the finalized recording is being uploaded", async () => {
    const user = userEvent.setup();
    const view = await renderPage();
    await screen.findByRole("button", { name: "Start recording" });

    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await user.click(screen.getByRole("button", { name: "Stop answering" }));

    const presign = deferred<{
      answerId: string;
      presignedUrl: string;
      storageKey: string;
    }>();
    mocks.getPresignedUrl.mockReturnValueOnce(presign.promise);
    await setFinalizedBlob(view);
    await waitFor(() => expect(mocks.getPresignedUrl).toHaveBeenCalled());

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    expect(mocks.stopStream).toHaveBeenCalled();

    presign.resolve({
      answerId: "answer-1",
      presignedUrl: "https://storage.example/upload",
      storageKey: "answers/answer-1.webm",
    });
    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalled());

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(mocks.stopStream).toHaveBeenCalledTimes(2);
  });

  it("does not complete the last question until its upload finishes, then gates dashboard return on completion", async () => {
    const user = userEvent.setup();
    const view = await renderPage();
    await screen.findByRole("button", { name: "Start recording" });

    for (let index = 0; index < 2; index += 1) {
      await user.click(screen.getByRole("button", { name: "Start recording" }));
      await user.click(screen.getByRole("button", { name: "Stop answering" }));
      await uploadCurrentQuestion(view);
      await user.click(screen.getByRole("button", { name: "Next question" }));
      await screen.findByRole("button", { name: "Start recording" });
      mocks.recording.blob = null;
    }

    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await user.click(screen.getByRole("button", { name: "Stop answering" }));
    expect(screen.getByRole("button", { name: "Finish test" })).toBeDisabled();
    expect(mocks.completeSubmission).not.toHaveBeenCalled();

    const completion = deferred<void>();
    mocks.completeSubmission.mockReturnValueOnce(completion.promise);
    await setFinalizedBlob(view);
    await waitFor(() => expect(mocks.getPresignedUrl).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish test" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Finish test" }));
    await waitFor(() => expect(mocks.completeSubmission).toHaveBeenCalledWith("submission-1"));
    expect(screen.getByRole("button", { name: /Uploading \(0 remaining\)/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Return to dashboard" })).not.toBeInTheDocument();

    completion.resolve(undefined);
    expect(await screen.findByRole("button", { name: "Return to dashboard" })).toBeEnabled();
  });

  it("exposes a retryable completion failure instead of permanently marking the submission complete", async () => {
    const user = userEvent.setup();
    const view = await renderPage();
    await screen.findByRole("button", { name: "Start recording" });

    mocks.completeSubmission.mockRejectedValueOnce(new Error("temporary failure"));

    for (let index = 0; index < 3; index += 1) {
      await user.click(screen.getByRole("button", { name: "Start recording" }));
      await user.click(screen.getByRole("button", { name: "Stop answering" }));
      await uploadCurrentQuestion(view);
      if (index < 2) {
        await user.click(screen.getByRole("button", { name: "Next question" }));
        await screen.findByRole("button", { name: "Start recording" });
        mocks.recording.blob = null;
      }
    }

    await user.click(screen.getByRole("button", { name: "Finish test" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry submission" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Uploading \(0 remaining\)/i })).toBeDisabled();

    mocks.completeSubmission.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole("button", { name: "Retry submission" }));
    await waitFor(() => expect(mocks.completeSubmission).toHaveBeenCalledTimes(2));
  });

  it("does not leave an unauthenticated route in an infinite loading state", async () => {
    Object.assign(mocks.assessmentStart, { studentId: null, mediaReady: false });

    await renderPage();

    expect(await screen.findByRole("heading", { name: "Session unavailable" })).toBeInTheDocument();
    expect(mocks.initializeTest).not.toHaveBeenCalled();
  });
});
