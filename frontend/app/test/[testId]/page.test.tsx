import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CONSENT_TEXT_VERSION, clearConsent, storeConsent } from "@/lib/consent";
import { ApiError } from "@/lib/api";
import { ASSESSMENT_START_INTENT_STORAGE_KEY } from "@/lib/assessment-start-intent";
import TestPage from "./page";

const mocks = vi.hoisted(() => ({
  completeSubmission: vi.fn(),
  confirmUpload: vi.fn(),
  getPresignedUrl: vi.fn(),
  initializeTest: vi.fn(),
  initializePractice: vi.fn(),
  requestPermissions: vi.fn(),
  abandonSubmission: vi.fn(),
  abandonSubmissionOnLeave: vi.fn(),
  sendHeartbeat: vi.fn(),
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
    failure: null as string | null,
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
  initializePractice: mocks.initializePractice,
}));

vi.mock("@/lib/test-api", () => ({
  abandonSubmission: mocks.abandonSubmission,
  abandonSubmissionOnLeave: mocks.abandonSubmissionOnLeave,
  completeSubmission: mocks.completeSubmission,
  sendHeartbeat: mocks.sendHeartbeat,
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

let params = Promise.resolve({ testId: "test-1" });
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

/** A take big enough (>= 8 KB) not to be flagged as short or silent. */
function fullTake() {
  return new Blob([new Uint8Array(10_000)], { type: "video/webm" });
}

async function rerenderPage(view: PageView) {
  await act(async () => {
    view.rerender(
      <Suspense fallback={<div>loading page</div>}>
        <TestPage params={params} />
      </Suspense>,
    );
    await params;
  });
}

async function setFinalizedBlob(view: PageView, duration = 12, blob = fullTake()) {
  mocks.recording.blob = blob;
  mocks.recording.duration = duration;
  await rerenderPage(view);
}

/** Starts recording the current slot by ending its preparation. */
async function startSlot(onComplete: () => void) {
  const before = mocks.startRecording.mock.calls.length;
  await act(async () => onComplete());
  await waitFor(() => expect(mocks.startRecording.mock.calls.length).toBe(before + 1));
}

/** The page beats immediately on `online`; wait for that beat to settle. */
async function beatNow() {
  const before = mocks.sendHeartbeat.mock.calls.length;
  await act(async () => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(mocks.sendHeartbeat.mock.calls.length).toBeGreaterThan(before));
  await act(async () => {});
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
    storeConsent("student-1");
    mocks.completeSubmission.mockResolvedValue(undefined);
    mocks.sendHeartbeat.mockResolvedValue(undefined);
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
    mocks.recording.failure = null;
    mocks.useCountdown.mockImplementation((_seconds: number, cb: () => void) => {
      onComplete = cb;
      return mocks.countdown;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    params = Promise.resolve({ testId: "test-1" });
  });

  it("runs practice from the Practice Test Set without a Submission, uploads or completion", async () => {
    params = Promise.resolve({ testId: "practice" });
    mocks.initializePractice.mockResolvedValue({
      submissionId: null,
      testSet: { id: "set-practice", code: "Practice_Question" },
      questions,
      uploadedEntryIds: [],
    });
    const view = await renderPage();
    expect(
      await screen.findByRole("heading", { name: "SPEAKNUSA PRACTICE TEST — NOT SCORED, NOTHING IS SAVED" }),
    ).toBeInTheDocument();
    for (let index = 0; index < 5; index += 1) await recordCurrentSlot(view, onComplete);

    expect(await screen.findByRole("heading", { name: /tried all 5 parts/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take the real test" })).toBeInTheDocument();
    expect(mocks.startRecording).toHaveBeenCalledTimes(5);
    expect(mocks.initializeTest).not.toHaveBeenCalled();
    expect(mocks.getPresignedUrl).not.toHaveBeenCalled();
    expect(mocks.completeSubmission).not.toHaveBeenCalled();
    expect(mocks.stopStream).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.stopStream).toHaveBeenCalled();
    view.unmount();
    expect(mocks.sendHeartbeat).not.toHaveBeenCalled();
    expect(mocks.abandonSubmissionOnLeave).not.toHaveBeenCalled();
  });

  it("sends a heartbeat once the Submission exists (FR-2.7)", async () => {
    await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await waitFor(() => expect(mocks.sendHeartbeat).toHaveBeenCalledWith("submission-1", expect.any(AbortSignal)));
  });

  it("pauses preparation while the connection is lost and resumes the same slot (FR-2.7)", async () => {
    await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await waitFor(() => expect(mocks.sendHeartbeat).toHaveBeenCalled());

    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost — reconnecting");
    await act(async () => onComplete());
    expect(mocks.startRecording).not.toHaveBeenCalled();

    mocks.countdown.start.mockClear();
    await act(async () => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(screen.queryByText("Connection lost — reconnecting")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Part 1 · Task 1A" })).toBeInTheDocument();
    expect(mocks.countdown.start).toHaveBeenCalled();
    await startSlot(onComplete);
  });

  it("pauses preparation on one failed heartbeat and resumes after the next succeeds", async () => {
    await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await waitFor(() => expect(mocks.sendHeartbeat).toHaveBeenCalled());

    mocks.sendHeartbeat.mockRejectedValueOnce(new ApiError("Service unavailable", 503));
    await beatNow();
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost — reconnecting");
    await act(async () => onComplete());
    expect(mocks.startRecording).not.toHaveBeenCalled();

    await beatNow();
    await waitFor(() => expect(screen.queryByText("Connection lost — reconnecting")).not.toBeInTheDocument());
  });

  it("does not end a take on one heartbeat timeout or 5xx", async () => {
    await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await waitFor(() => expect(mocks.sendHeartbeat).toHaveBeenCalled());
    await startSlot(onComplete);

    mocks.sendHeartbeat
      .mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"))
      .mockRejectedValueOnce(new ApiError("Bad gateway", 502));
    await beatNow();
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost — reconnecting");
    await beatNow();
    expect(mocks.stopRecording).not.toHaveBeenCalled();
  });

  it("ends a recording take after three consecutive failed heartbeats", async () => {
    await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await waitFor(() => expect(mocks.sendHeartbeat).toHaveBeenCalled());
    await startSlot(onComplete);

    mocks.sendHeartbeat.mockRejectedValue(new TypeError("Failed to fetch"));
    await beatNow();
    await beatNow();
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost — reconnecting");
    expect(mocks.stopRecording).not.toHaveBeenCalled();

    await beatNow();
    await waitFor(() => expect(mocks.stopRecording).toHaveBeenCalled());
  });

  it("resets the failure count after a successful heartbeat", async () => {
    await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await waitFor(() => expect(mocks.sendHeartbeat).toHaveBeenCalled());
    await startSlot(onComplete);

    mocks.sendHeartbeat
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await beatNow();
    await beatNow();
    await beatNow();
    expect(screen.queryByText("Connection lost — reconnecting")).not.toBeInTheDocument();
    await beatNow();
    await beatNow();
    expect(mocks.stopRecording).not.toHaveBeenCalled();
  });

  it("ends a recording take on one failed heartbeat when the browser is offline", async () => {
    await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await waitFor(() => expect(mocks.sendHeartbeat).toHaveBeenCalled());
    await startSlot(onComplete);

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mocks.sendHeartbeat.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await beatNow();
    await waitFor(() => expect(mocks.stopRecording).toHaveBeenCalled());
  });

  it("shows an ended state when the server already ended the Submission", async () => {
    mocks.sendHeartbeat.mockRejectedValue(new ApiError("Not in progress", 409, undefined, "SUBMISSION_NOT_IN_PROGRESS"));
    const view = await renderPage();
    expect(await screen.findByRole("heading", { name: "This Assessment has ended" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to dashboard" })).toBeInTheDocument();
    expect(mocks.stopStream).toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    view.unmount();
    expect(mocks.abandonSubmissionOnLeave).not.toHaveBeenCalled();
  });

  it("abandons the Submission and clears the start intent on pagehide (FR-2.8)", async () => {
    await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    expect(sessionStorage.getItem(ASSESSMENT_START_INTENT_STORAGE_KEY)).toBeNull();
    sessionStorage.setItem(ASSESSMENT_START_INTENT_STORAGE_KEY, "{}");

    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.abandonSubmissionOnLeave).toHaveBeenCalledWith("submission-1");
    expect(sessionStorage.getItem(ASSESSMENT_START_INTENT_STORAGE_KEY)).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.abandonSubmissionOnLeave).toHaveBeenCalledTimes(1);
  });

  it("abandons on client-side navigation away (unmount)", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    view.unmount();
    expect(mocks.abandonSubmissionOnLeave).toHaveBeenCalledWith("submission-1");
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

  it("lets the student stop recording early, then uploads and advances", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    expect(screen.queryByRole("button", { name: /stop and submit/i })).not.toBeInTheDocument();

    await act(async () => onComplete());
    await userEvent.click(await screen.findByRole("button", { name: /stop and submit answer/i }));
    expect(mocks.stopRecording).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /saving answer/i })).toBeDisabled();

    await setFinalizedBlob(view, 5);
    await waitFor(() => expect(mocks.getPresignedUrl).toHaveBeenCalledWith("submission-1", "entry-1", "video/webm"));
    expect(await screen.findByRole("heading", { name: "Part 1 · Task 1B" })).toBeInTheDocument();
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
    expect(mocks.stopStream).not.toHaveBeenCalled();
    presign.resolve({ answerId: "a", presignedUrl: "https://storage.example/upload", storageKey: "k" });
  });

  it("warns before leaving and keeps Leave disabled while an upload has failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.uploadToR2.mockRejectedValue(new Error("network down"));
      const view = await renderPage();
      await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
      await recordCurrentSlot(view, onComplete);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      // Slot 2 is only preparing; the failed take exists only in page memory.
      expect(await screen.findByRole("heading", { name: "Part 1 · Task 1B" })).toBeInTheDocument();
      const beforeUnload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(beforeUnload);
      expect(beforeUnload.defaultPrevented).toBe(true);
      expect(mocks.stopStream).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Leave assessment" })).toBeDisabled();

      mocks.uploadToR2.mockResolvedValue(undefined);
      await act(async () => {
        window.dispatchEvent(new Event("online"));
        await vi.advanceTimersByTimeAsync(1_000);
      });
      await waitFor(() => expect(screen.getByRole("button", { name: "Leave assessment" })).toBeEnabled());
      const afterRetry = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(afterRetry);
      expect(afterRetry.defaultPrevented).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not warn about failed uploads once the server has ended the Submission", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.uploadToR2.mockRejectedValue(new Error("network down"));
      const view = await renderPage();
      await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
      await recordCurrentSlot(view, onComplete);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      mocks.sendHeartbeat.mockRejectedValue(new ApiError("Not in progress", 409, undefined, "SUBMISSION_NOT_IN_PROGRESS"));
      await act(async () => window.dispatchEvent(new Event("online")));
      expect(await screen.findByRole("heading", { name: "This Assessment has ended" })).toBeInTheDocument();

      // The takes can no longer be saved, so "Return to dashboard" leaves without a prompt.
      const beforeUnload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(beforeUnload);
      expect(beforeUnload.defaultPrevented).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the devices and the take when the student stays after the leave prompt", async () => {
    // Like the real coordinator, stopping the stream drops media readiness.
    mocks.stopStream.mockImplementation(() => {
      Object.assign(mocks.assessmentStart, { mediaReady: false, isVideoReady: false, isAudioReady: false });
    });
    onTestFinished(() => {
      mocks.stopStream.mockReset();
    });
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await startSlot(onComplete);

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    expect(mocks.stopStream).not.toHaveBeenCalled();

    // "Stay": no pagehide follows, so the take records to the end unflagged.
    await rerenderPage(view);
    expect(mocks.stopRecording).not.toHaveBeenCalled();
    await setFinalizedBlob(view);
    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledWith("submission-1", "entry-1", {
      sizeBytes: 10_000,
      durationSeconds: 12,
      technicalFailure: undefined,
    }));
    expect(await screen.findByRole("heading", { name: "Part 1 · Task 1B" })).toBeInTheDocument();
  });

  it("releases the devices once the student actually leaves (pagehide)", async () => {
    await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await startSlot(onComplete);
    expect(mocks.stopStream).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.stopStream).toHaveBeenCalled();
  });

  it("uploads a camera-dropped take flagged as CAMERA_DROP and keeps the test going (FR-4.3)", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await startSlot(onComplete);

    Object.assign(mocks.assessmentStart, { mediaReady: false, isVideoReady: false });
    await rerenderPage(view);
    expect(mocks.stopRecording).toHaveBeenCalled();

    // The recorder hands over the partial take after the stop.
    await setFinalizedBlob(view, 7);
    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledWith("submission-1", "entry-1", {
      sizeBytes: 10_000,
      durationSeconds: 7,
      technicalFailure: { type: "CAMERA_DROP", reason: "Camera stopped while the answer was recording" },
    }));
    expect(await screen.findByRole("heading", { name: "Part 1 · Task 1B" })).toBeInTheDocument();
  });

  it("uploads a short take flagged as short or silent, with no retry prompt (FR-3.8)", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await startSlot(onComplete);
    await setFinalizedBlob(view, 1, new Blob([], { type: "video/webm" }));

    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledWith("submission-1", "entry-1", {
      sizeBytes: 0,
      durationSeconds: 1,
      technicalFailure: {
        type: "TECHNICAL_FAILURE",
        reason: "Recording is shorter than 2 seconds or 8 KB; it may be short or silent",
      },
    }));
    expect(await screen.findByRole("heading", { name: "Part 1 · Task 1B" })).toBeInTheDocument();
  });

  it("uploads a full take without a technical failure", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await recordCurrentSlot(view, onComplete);
    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledWith("submission-1", "entry-1", {
      sizeBytes: 10_000,
      durationSeconds: 12,
      technicalFailure: undefined,
    }));
  });

  it("uploads a recorder-failed partial take flagged with the recorder's reason", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await startSlot(onComplete);
    mocks.recording.failure = "The recorder stopped unexpectedly";
    await setFinalizedBlob(view, 20);

    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledWith("submission-1", "entry-1", {
      sizeBytes: 10_000,
      durationSeconds: 20,
      technicalFailure: { type: "TECHNICAL_FAILURE", reason: "The recorder stopped unexpectedly" },
    }));
  });

  it("ends and flags the take when the connection drops while recording", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    await startSlot(onComplete);

    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(mocks.stopRecording).toHaveBeenCalled();
    await setFinalizedBlob(view, 9);

    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledWith("submission-1", "entry-1", {
      sizeBytes: 10_000,
      durationSeconds: 9,
      technicalFailure: { type: "TECHNICAL_FAILURE", reason: "Connection lost while the answer was recording" },
    }));
  });

  it("does not pause preparation on camera loss; the take starts and is flagged", async () => {
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });

    Object.assign(mocks.assessmentStart, { mediaReady: false, isVideoReady: false });
    await rerenderPage(view);
    // A non-blocking reconnect prompt, not a pause screen: the slot stays on.
    expect(screen.getByText(/Camera disconnected. The test continues/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect devices" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Part 1 · Task 1A" })).toBeInTheDocument();

    await startSlot(onComplete);
    expect(mocks.startRecording).toHaveBeenLastCalledWith(null, 60);
    await setFinalizedBlob(view, 0, new Blob([], { type: "video/webm" }));

    await waitFor(() => expect(mocks.confirmUpload).toHaveBeenCalledWith("submission-1", "entry-1", {
      sizeBytes: 0,
      durationSeconds: 0,
      technicalFailure: {
        type: "CAMERA_DROP",
        reason: "Camera was unavailable when the answer should start recording",
      },
    }));
    expect(await screen.findByRole("heading", { name: "Part 1 · Task 1B" })).toBeInTheDocument();
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

    window.dispatchEvent(new Event("pagehide"));
    view.unmount();
    expect(mocks.abandonSubmissionOnLeave).not.toHaveBeenCalled();
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

  it("treats an Answer already verified by a lost confirm response as uploaded", async () => {
    mocks.getPresignedUrl.mockRejectedValue(new Error("Answer already uploaded"));
    const view = await renderPage();
    await screen.findByRole("heading", { name: "Part 1 · Task 1A" });
    for (let index = 0; index < 5; index += 1) await recordCurrentSlot(view, onComplete);

    await waitFor(() => expect(mocks.completeSubmission).toHaveBeenCalledWith("submission-1"));
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
    expect(mocks.confirmUpload).not.toHaveBeenCalled();
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

  it("starts no capture and no Submission without informed consent (FR-2.6)", async () => {
    clearConsent();
    Object.assign(mocks.assessmentStart, { mediaReady: false, isAudioReady: false, isVideoReady: false });

    await renderPage();

    expect(await screen.findByRole("heading", { name: "Consent and system check needed" })).toBeInTheDocument();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.initializeTest).not.toHaveBeenCalled();
  });

  it("sends the accepted consent version when creating the Submission", async () => {
    await renderPage();
    await waitFor(() => expect(mocks.initializeTest).toHaveBeenCalledWith("student-1", CONSENT_TEXT_VERSION));
  });
});
