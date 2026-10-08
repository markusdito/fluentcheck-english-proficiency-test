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
  useCountdown: vi.fn(),
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
  useCountdown: (seconds: number, onComplete: () => void) => mocks.useCountdown(seconds, onComplete),
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

const questions = ["PART_1A", "PART_1B", "PART_2", "PART_3", "PART_4"].map((category, index) => ({
  id: `entry-${index + 1}`,
  audioUrl: null,
  tasks: [`Prompt ${index + 1}`],
  task: `Prompt ${index + 1}`,
  prepTime: 0,
  recordingDuration: 60,
  order: index + 1,
  category,
  cueCard: null,
  options: null,
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

/** Prep ends (mocked countdown fires onComplete), recording auto-starts, then auto-stops with a blob. */
async function recordCurrentSlot(view: PageView, onComplete: () => void) {
  const before = mocks.startRecording.mock.calls.length;
  await act(async () => onComplete());
  await waitFor(() => expect(mocks.startRecording.mock.calls.length).toBe(before + 1));
  await setFinalizedBlob(view);
  mocks.recording.blob = null;
  await act(async () => {
    view.rerender(
      <Suspense fallback={<div>loading page</div>}>
        <TestPage params={params} />
      </Suspense>,
    );
  });
}

describe("TestPage strict exam flow", () => {
  let onComplete: () => void = () => {};

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
      testSet: { id: "set-a", code: "A" },
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
    mocks.useCountdown.mockImplementation((_seconds: number, cb: () => void) => {
      onComplete = cb;
      return mocks.countdown;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the Test Set title and Part/Task header with no manual recording controls", async () => {
    await renderPage();
    expect(
      await screen.findByRole("heading", { name: "SPEAKNUSA SPEAKING ASSESSMENT — TEST SET A" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Part 1 · Task 1A" })).toBeInTheDocument();
    for (const name of [/start recording/i, /stop answering/i, /next question/i, /re-record/i, /finish test/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("auto-starts recording at the end of preparation and auto-advances without waiting for the upload", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });

    const confirm = deferred<void>();
    mocks.confirmUpload.mockReturnValueOnce(confirm.promise);
    await recordCurrentSlot(view, onComplete);

    expect(mocks.startRecording).toHaveBeenCalledWith(mocks.stream, 60);
    await waitFor(() => expect(mocks.getPresignedUrl).toHaveBeenCalledWith("submission-1", "entry-1", "video/webm"));
    // Advanced to the next slot while entry-1 is still verifying.
    expect(await screen.findByRole("heading", { name: "Part 1 · Task 1B" })).toBeInTheDocument();
    expect(mocks.completeSubmission).not.toHaveBeenCalled();
    confirm.resolve(undefined);
  });

  it("blocks navigation while a background upload is pending", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });

    const presign = deferred<{ answerId: string; presignedUrl: string; storageKey: string }>();
    mocks.getPresignedUrl.mockReturnValueOnce(presign.promise);
    await recordCurrentSlot(view, onComplete);
    await waitFor(() => expect(mocks.getPresignedUrl).toHaveBeenCalled());

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    expect(mocks.stopStream).toHaveBeenCalled();
    presign.resolve({ answerId: "a", presignedUrl: "https://storage.example/upload", storageKey: "k" });
  });

  it("shows the completion screen only after all five Answers are verified and the Submission completes", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });

    const lastConfirm = deferred<void>();
    for (let index = 0; index < 5; index += 1) {
      if (index === 4) mocks.confirmUpload.mockReturnValueOnce(lastConfirm.promise);
      await recordCurrentSlot(view, onComplete);
    }

    expect(await screen.findByRole("heading", { name: "Saving your answers" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledTimes(5));
    expect(mocks.completeSubmission).not.toHaveBeenCalled();
    expect(screen.queryByText(/successfully recorded and uploaded/)).not.toBeInTheDocument();

    lastConfirm.resolve(undefined);
    await waitFor(() => expect(mocks.completeSubmission).toHaveBeenCalledWith("submission-1"));
    expect(
      await screen.findByRole("heading", { name: "All 5 answers successfully recorded and uploaded" }),
    ).toBeInTheDocument();
    expect(screen.getByText("submission-1")).toBeInTheDocument();
    expect(screen.getAllByText("Saved for Evaluation").length).toBeGreaterThan(0);
  });

  it("retries a failed upload from the kept take instead of re-recording", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.uploadToR2.mockRejectedValue(new Error("network down"));
      const view = await renderPage();
      await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
      for (let index = 0; index < 5; index += 1) await recordCurrentSlot(view, onComplete);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(await screen.findByRole("button", { name: "Retry upload" })).toBeInTheDocument();
      expect(mocks.startRecording).toHaveBeenCalledTimes(5);

      mocks.uploadToR2.mockResolvedValue(undefined);
      await act(async () => {
        screen.getByRole("button", { name: "Retry upload" }).click();
        await vi.advanceTimersByTimeAsync(1_000);
      });
      await waitFor(() => expect(mocks.completeSubmission).toHaveBeenCalled());
      expect(mocks.startRecording).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes a retryable completion failure", async () => {
    mocks.completeSubmission.mockRejectedValueOnce(new Error("temporary failure"));
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    for (let index = 0; index < 5; index += 1) await recordCurrentSlot(view, onComplete);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Retry submission" }));
    await waitFor(() => expect(mocks.completeSubmission).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("heading", { name: "All 5 answers successfully recorded and uploaded" }),
    ).toBeInTheDocument();
  });

  it("does not leave an unauthenticated route in an infinite loading state", async () => {
    Object.assign(mocks.assessmentStart, { studentId: null, mediaReady: false });

    await renderPage();

    expect(await screen.findByRole("heading", { name: "Session unavailable" })).toBeInTheDocument();
    expect(mocks.initializeTest).not.toHaveBeenCalled();
  });
});
