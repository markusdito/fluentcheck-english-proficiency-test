"use client";

import { useEffect, useState, useCallback, use, useRef, useReducer } from "react";
import { useAssessmentStart } from "@/components/providers/AssessmentStartProvider";
import { useRecording } from "@/hooks/useRecording";
import { useCountdown } from "@/hooks/useCountdown";
import { WebcamPreview } from "@/components/test/WebcamPreview";
import { PromptDisplay } from "@/components/test/PromptDisplay";
import { SlotTimers } from "@/components/test/SlotTimers";
import { PageState } from "@/components/student/PageShell";
import { Pill } from "@/components/student/StatusPill";
import {
  card,
  container,
  ghostButton,
  h2,
  h3,
  meta,
  primaryButton,
  secondaryButton,
} from "@/components/student/styles";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { abandonSubmission, completeSubmission } from "@/lib/test-api";
import { ApiError } from "@/lib/api";
import { initializeTest } from "@/lib/test-initialization";
import { slotLabel } from "@/lib/assessment-slots";
import { clearAssessmentStartIntent } from "@/lib/assessment-start-intent";
import { getPresignedUrl, uploadToR2, confirmUpload } from "@/lib/upload-api";
import type { Prompt, UploadStatus, QuestionUploadState } from "@/types/test";
import { areAllManifestEntriesUploaded, initializeUploadStates } from "@/lib/recording-upload-state";
import { entryMachinesReducer } from "@/lib/recording-state-machine";

type TestPhase = "loading" | "preparation" | "recording" | "finalizing" | "media-paused" | "completed";

/** Prompt audio plays per slot, autoplay included (PRD FR-3.4). */
const PROMPT_MAX_PLAYS = 2;
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAY_MS = 2000;
const PENDING_UPLOAD: UploadStatus[] = ["blob-ready", "signing", "getting-url", "uploading", "verifying"];

type UploadState = Record<string, QuestionUploadState>;

export default function TestPage({ params }: { params: Promise<{ testId: string }> }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { testId } = use(params);

  // The authenticated app provider owns the single stream across the
  // permission UI and this route. Assessment initialization waits for live
  // camera and microphone tracks.
  const {
    stream,
    requestPermissions,
    stopStream,
    mediaReady,
    isVideoReady,
    isAudioReady,
    videoError,
    audioError,
    monitorError,
    studentId,
    sessionPending,
    sessionError,
    isLoading: mediaLoading,
  } = useAssessmentStart();

  const { blob, duration: recDuration, error: recError, startRecording, stopRecording, resetRecording } = useRecording();

  const [questions, setQuestions] = useState<Prompt[]>([]);
  const [fetchError, setFetchError] = useState<{
    message: string;
    isSubmissionConflict: boolean;
  } | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [testSetCode, setTestSetCode] = useState<string | null>(null);
  const [mediaRecoveryError, setMediaRecoveryError] = useState<string | null>(null);
  const [abandonPending, setAbandonPending] = useState(false);
  const [abandonError, setAbandonError] = useState<string | null>(null);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);

  // Slot flow: preparation → recording → finalizing → next slot, no manual controls.
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<TestPhase>("loading");
  const [playsUsed, setPlaysUsed] = useState<Record<string, number>>({});
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const [submissionCompleted, setSubmissionCompleted] = useState(false);

  // Upload state per manifest entry. Takes are kept in memory until verified
  // so a failed upload is retried without re-recording (one take per slot).
  const [uploadStates, setUploadStates] = useState<UploadState>({});
  const [, dispatchEntryMachine] = useReducer(entryMachinesReducer, {});
  const uploadRef = useRef<Map<string, Promise<void>>>(new Map());
  const takesRef = useRef<Map<string, { blob: Blob; durationSeconds: number }>>(new Map());
  const submissionIdRef = useRef<string | null>(null);

  useEffect(() => {
    submissionIdRef.current = submissionId;
  }, [submissionId]);

  // Guard against React StrictMode double-mount in dev mode
  const initCalled = useRef(false);

  const currentQuestion = questions[currentQuestionIndex];
  const totalQuestions = questions.length;
  const playsLeft = currentQuestion
    ? Math.max(0, PROMPT_MAX_PLAYS - (playsUsed[currentQuestion.id] ?? 0))
    : 0;
  const uploadsPending = Object.values(uploadStates).some((state) => PENDING_UPLOAD.includes(state.status));
  const recordingMutationPending = phase === "recording" || phase === "finalizing" || uploadsPending;

  // Fetch questions + create/replay the Submission only after media is ready.
  useEffect(() => {
    if (initCalled.current || sessionPending || !studentId || !mediaReady) return;
    initCalled.current = true;

    const init = async () => {
      try {
        const initialized = await initializeTest(studentId);
        const states = initializeUploadStates(
          initialized.questions.map((question) => question.id),
          initialized.uploadedEntryIds,
        );
        // ponytail: a reload resumes at the first slot without a verified
        // Answer; network-loss-only resume and abandon-on-leave are #174.
        const firstOpen = initialized.questions.findIndex((question) => states[question.id]?.status !== "uploaded");
        setSubmissionId(initialized.submissionId);
        setTestSetCode(initialized.testSet?.code ?? null);
        setUploadStates(states);
        setCurrentQuestionIndex(Math.max(0, firstOpen));
        setQuestions(initialized.questions);
        if (firstOpen === -1 && initialized.questions.length > 0) setPhase("completed");
      } catch (err) {
        const isSubmissionConflict = err instanceof ApiError && err.statusCode === 409;
        const message = err instanceof Error ? err.message : "Failed to initialize Assessment";
        setFetchError({ message, isSubmissionConflict });
      }
    };

    init();
  }, [mediaReady, sessionPending, studentId]);

  // Recording starts automatically when preparation ends (PRD FR-3.5).
  const onPrepComplete = useCallback(() => {
    if (stream && mediaReady && phase === "preparation" && currentQuestion) {
      startRecording(stream, currentQuestion.recordingDuration);
      setPhase("recording");
    }
  }, [stream, mediaReady, phase, startRecording, currentQuestion]);

  const prepCountdown = useCountdown(currentQuestion?.prepTime ?? 0, onPrepComplete);

  const handleRecoverMedia = useCallback(async () => {
    setMediaRecoveryError(null);
    const success = await requestPermissions();
    if (!success) {
      setMediaRecoveryError("Both a working camera and microphone are required to continue.");
    }
  }, [requestPermissions]);

  // Media recovery gate: starting the assessment was the consent gesture, so
  // request device access automatically instead of waiting for a click.
  const autoRecoverRef = useRef(false);
  useEffect(() => {
    const gateVisible =
      phase === "loading" && !mediaReady && !fetchError && !sessionPending && Boolean(studentId);
    if (!gateVisible || autoRecoverRef.current || mediaLoading) return;
    autoRecoverRef.current = true;
    void handleRecoverMedia();
  }, [phase, mediaReady, fetchError, sessionPending, studentId, mediaLoading, handleRecoverMedia]);

  // Device loss. While recording, the take ends with whatever was captured and
  // the flow advances as usual: it is never re-recorded. During preparation
  // nothing is recorded yet, so the slot pauses until both devices return.
  // ponytail: flagging the partial take as a technical failure is #173.
  useEffect(() => {
    if (mediaReady) {
      if (phase === "media-paused") {
        // Media readiness is an external subscription boundary.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMediaRecoveryError(null);
        setPhase("preparation");
      }
      return;
    }
    if (phase === "recording") {
      stopRecording();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("finalizing");
    } else if (phase === "preparation") {
      prepCountdown.pause();
      setPhase("media-paused");
      setMediaRecoveryError(null);
    }
  }, [mediaReady, phase, prepCountdown, stopRecording]);

  // Guard: stop camera stream on any navigation away from the test page.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (recordingMutationPending) {
        event.preventDefault();
        event.returnValue = "";
      }
      stopStream();
    };
    const handlePopState = () => {
      stopStream();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [recordingMutationPending, stopStream]);

  // Transition from loading to preparation once questions and stream are ready
  useEffect(() => {
    if (questions.length > 0 && mediaReady && phase === "loading") {
      // This synchronizes two independently resolved external inputs.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("preparation");
    }
  }, [questions, mediaReady, phase]);

  // Preparation starts when the prompt audio ends. A slot without audio, or
  // whose plays are used up (after a device pause), starts it immediately.
  const playsLeftRef = useRef(playsLeft);
  useEffect(() => {
    playsLeftRef.current = playsLeft;
  }, [playsLeft]);
  useEffect(() => {
    if (phase === "preparation") {
      prepCountdown.reset();
      if (!currentQuestion?.audioUrl || playsLeftRef.current === 0) {
        prepCountdown.start();
      }
    }
    return () => {
      prepCountdown.pause();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentQuestionIndex]);

  const handlePromptAudioEnded = useCallback(() => {
    if (phase === "preparation" && !prepCountdown.isRunning && !prepCountdown.isComplete) {
      prepCountdown.start();
    }
  }, [phase, prepCountdown]);

  const handlePromptPlayStarted = useCallback(() => {
    const entryId = currentQuestion?.id;
    if (!entryId) return;
    setPlaysUsed((prev) => ({ ...prev, [entryId]: (prev[entryId] ?? 0) + 1 }));
  }, [currentQuestion]);

  const setEntryStatus = useCallback((entryId: string, state: QuestionUploadState) => {
    setUploadStates((prev) => ({ ...prev, [entryId]: state }));
  }, []);

  /** Background upload with automatic retries; the flow never waits for it (PRD FR-5.4). */
  const startUpload = useCallback((entryId: string) => {
    const take = takesRef.current.get(entryId);
    const currentSubmissionId = submissionIdRef.current;
    if (!take || !currentSubmissionId || uploadRef.current.has(entryId)) return;

    const uploadPromise = (async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          setEntryStatus(entryId, { status: "signing" });
          dispatchEntryMachine({ entryId, event: { type: "UPLOAD_STARTED" } });
          const { presignedUrl } = await getPresignedUrl(currentSubmissionId, entryId, take.blob.type || "video/webm");

          setEntryStatus(entryId, { status: "uploading" });
          dispatchEntryMachine({ entryId, event: { type: "SIGNED" } });
          await uploadToR2(presignedUrl, take.blob);

          // Server verification phase.
          setEntryStatus(entryId, { status: "verifying" });
          dispatchEntryMachine({ entryId, event: { type: "UPLOAD_FINISHED" } });
          await confirmUpload(currentSubmissionId, entryId, {
            sizeBytes: take.blob.size,
            durationSeconds: take.durationSeconds,
          });

          setEntryStatus(entryId, { status: "uploaded" });
          dispatchEntryMachine({ entryId, event: { type: "VERIFIED" } });
          takesRef.current.delete(entryId);
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          console.error("Upload error for entry", entryId, err);
          dispatchEntryMachine({ entryId, event: { type: "FAILED", message } });
          if (attempt >= UPLOAD_ATTEMPTS) {
            setEntryStatus(entryId, { status: "error", error: message });
            return;
          }
          dispatchEntryMachine({ entryId, event: { type: "RETRY" } });
          await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_DELAY_MS * attempt));
        }
      }
    })().finally(() => {
      uploadRef.current.delete(entryId);
    });

    uploadRef.current.set(entryId, uploadPromise);
  }, [setEntryStatus]);

  const retryUpload = useCallback((entryId: string) => {
    if (!takesRef.current.has(entryId)) return;
    dispatchEntryMachine({ entryId, event: { type: "RETRY" } });
    startUpload(entryId);
  }, [startUpload]);

  // The take ends when MediaRecorder hands over its blob after the automatic
  // stop: queue its upload and advance at once, with no preview.
  useEffect(() => {
    if ((phase !== "recording" && phase !== "finalizing") || !currentQuestion) return;
    const entryId = currentQuestion.id;
    if (blob && blob.size > 0) {
      takesRef.current.set(entryId, { blob, durationSeconds: recDuration });
      // The blob arrives from MediaRecorder's asynchronous onstop callback.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntryStatus(entryId, { status: "blob-ready" });
      dispatchEntryMachine({ entryId, event: { type: "START_RECORDING" } });
      dispatchEntryMachine({ entryId, event: { type: "STOP_REQUESTED" } });
      dispatchEntryMachine({ entryId, event: { type: "BLOB_READY", blob } });
      startUpload(entryId);
    } else if (recError) {
      // No take to upload ("failure" is not retryable) and no re-record;
      // ponytail: saving and flagging the partial take is #173.
      setEntryStatus(entryId, { status: "failure", error: recError });
    } else {
      return;
    }
    resetRecording();
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setPhase("preparation");
    } else {
      setPhase("completed");
    }
  }, [blob, recError, phase, currentQuestion, currentQuestionIndex, totalQuestions, recDuration, resetRecording, setEntryStatus, startUpload]);

  const allUploaded = areAllManifestEntriesUploaded(
    questions.map((question) => question.id),
    uploadStates,
  );

  // Once every slot is recorded and every Answer verified, leave IN_PROGRESS.
  // The server re-checks the exact verified Answer set.
  useEffect(() => {
    if (phase !== "completed" || !allUploaded || submissionCompleted || completionPending || completionError) return;
    const sid = submissionIdRef.current;
    if (!sid) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompletionPending(true);
    setCompletionError(null);
    completeSubmission(sid)
      .then(() => setSubmissionCompleted(true))
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Failed to complete submission";
        setCompletionError(message);
      })
      .finally(() => setCompletionPending(false));
  }, [phase, allUploaded, submissionCompleted, completionPending, completionError]);

  const retryCompletion = () => {
    setCompletionError(null);
    setSubmissionCompleted(false);
  };

  const handleFinishTest = () => {
    // The coordinator owns synchronous track cleanup and monitor teardown.
    stopStream();
    clearAssessmentStartIntent();
    window.location.href = "/dashboard";
  };

  const handleAbandonTest = async () => {
    if (!submissionId || abandonPending) return;
    setAbandonPending(true);
    setAbandonError(null);
    try {
      await abandonSubmission(submissionId);
      clearAssessmentStartIntent();
      stopStream();
      window.location.href = "/dashboard";
    } catch (error) {
      setAbandonError(error instanceof Error ? error.message : "Could not abandon this Assessment.");
    } finally {
      setAbandonPending(false);
    }
  };

  const mediaFailureMessage = [
    videoError ? `Webcam: ${videoError}` : null,
    audioError ? `Microphone: ${audioError}` : null,
  ].filter((message): message is string => message !== null).join(" ") ||
    "Camera and microphone access is required to continue.";

  // Loading while the authenticated Student, media, and manifest are prepared.
  if (phase === "loading" && !fetchError && !sessionError && (sessionPending || (Boolean(studentId) && mediaReady))) {
    return (
      <PageState>
        <Loader2 className="mx-auto size-8 animate-spin text-sn-muted" aria-hidden="true" />
        <p className="mt-4 text-sn-muted" role="status">Loading questions…</p>
      </PageState>
    );
  }

  if (fetchError) {
    return (
      <PageState>
        <h1 className={h3}>Failed to load test</h1>
        <p className="mt-3 text-sn-muted">{fetchError.message}</p>
        {!fetchError.isSubmissionConflict && (
          <p className="mt-2 text-sm text-sn-muted">Please check your connection and try again.</p>
        )}
        <button
          type="button"
          className={`${primaryButton} mt-6 w-full`}
          onClick={() => {
            window.location.href = "/dashboard";
          }}
        >
          Return to dashboard
        </button>
      </PageState>
    );
  }

  if (sessionError || (!sessionPending && !studentId)) {
    return (
      <PageState>
        <h1 className={h3}>Session unavailable</h1>
        <p className="mt-3 text-sn-muted">Please sign in again before starting an Assessment.</p>
        <button type="button" className={`${primaryButton} mt-6 w-full`} onClick={() => window.location.reload()}>
          Try again
        </button>
      </PageState>
    );
  }

  if (phase === "loading" && !mediaReady && !fetchError && !sessionPending && studentId) {
    return (
      <PageState>
        <h1 className={h3}>Camera &amp; microphone required</h1>
        <p className="mt-3 text-sn-muted">
          This Assessment needs your webcam and microphone to record your responses.
        </p>
        <ul className="mt-5 list-none rounded-[10px] border border-sn-border bg-sn-surface p-4 text-left text-sm">
          <li>Webcam: {isVideoReady ? "ready" : videoError || "not ready"}</li>
          <li>Microphone: {isAudioReady ? "ready" : audioError || "not ready"}</li>
          {monitorError && <li>Mic monitor: unavailable; capture can continue</li>}
        </ul>
        <p className="mt-4 text-sm text-sn-muted" role="status">Requesting access to your camera and microphone…</p>
        {mediaRecoveryError && <p className="mt-3 text-sm text-sn-danger">{mediaRecoveryError}</p>}
      </PageState>
    );
  }

  if (phase === "media-paused") {
    return (
      <PageState>
        <h1 className={h3}>Camera or microphone disconnected</h1>
        <p className="mt-3 text-sn-muted">
          Your Submission is preserved. Reconnect both devices to continue this part&apos;s preparation.
        </p>
        <button
          type="button"
          className={`${primaryButton} mt-6 w-full`}
          onClick={() => void handleRecoverMedia()}
          disabled={mediaLoading}
        >
          {mediaLoading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Reconnect devices
        </button>
        <p className="mt-4 text-sm text-sn-danger">{mediaRecoveryError || mediaFailureMessage}</p>
      </PageState>
    );
  }

  const screenTitle = `SPEAKNUSA SPEAKING ASSESSMENT${testSetCode ? ` — TEST SET ${testSetCode}` : ""}`;

  // Every slot is recorded. The completion screen appears only once all
  // Answers are verified and the Submission has left IN_PROGRESS (FR-5.4).
  if (phase === "completed") {
    if (allUploaded && submissionCompleted) {
      return (
        <TestShell title={screenTitle}>
          <article className={card}>
            <Pill tone="green">Saved for Evaluation</Pill>
            <h2 className={`${h2} mt-4`}>All {totalQuestions} answers successfully recorded and uploaded</h2>
            <dl className="mt-6 grid gap-4 border-t border-sn-border pt-5 sm:grid-cols-2">
              <div>
                <dt className={meta}>Submission Reference ID</dt>
                <dd className="m-0 mt-1 font-mono text-[15px] break-all">{submissionId}</dd>
              </div>
              <div>
                <dt className={meta}>Status</dt>
                <dd className="m-0 mt-1 text-[15px] font-semibold">Saved for Evaluation</dd>
              </div>
            </dl>
            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-sn-border pt-5">
              <button type="button" className={primaryButton} onClick={handleFinishTest}>
                Return to dashboard
              </button>
            </div>
          </article>
        </TestShell>
      );
    }

    const verifiedCount = questions.filter((q) => uploadStates[q.id]?.status === "uploaded").length;
    // "error": upload failed, take kept for retry. "failure": nothing captured.
    const failedEntryIds = questions
      .filter((q) => ["error", "failure"].includes(uploadStates[q.id]?.status ?? ""))
      .map((q) => q.id);
    const retryEntryIds = failedEntryIds.filter((id) => uploadStates[id]?.status === "error");
    const retryable = retryEntryIds.length > 0;
    return (
      <TestShell title={screenTitle}>
        <article className={card}>
          <h2 className={h2}>Saving your answers</h2>
          <p className={`${meta} mt-2`}>Keep this page open</p>
          {failedEntryIds.length === 0 && !completionError && (
            <p className="mt-5 flex items-center gap-2 text-[15px] text-sn-muted" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {completionPending
                ? "Finalizing your submission…"
                : `Uploading answers · ${verifiedCount} of ${totalQuestions} saved`}
            </p>
          )}
          {failedEntryIds.length > 0 && (
            <div className="mt-5 rounded-[10px] bg-sn-field-amber p-4 text-[15px]" role="alert">
              <p className="m-0">
                {failedEntryIds.length} answer{failedEntryIds.length !== 1 ? "s" : ""} could not be saved.{" "}
                {retryable
                  ? "Check your connection and retry; your recordings stay on this device until they upload."
                  : "Please contact support."}
              </p>
              {retryable && (
                <button
                  type="button"
                  className={`${secondaryButton} mt-3`}
                  onClick={() => retryEntryIds.forEach(retryUpload)}
                >
                  Retry upload
                </button>
              )}
            </div>
          )}
          {completionError && (
            <div className="mt-5 rounded-[10px] bg-sn-field-amber p-4 text-[15px]" role="alert">
              <p className="m-0">Could not finalize this submission: {completionError}</p>
              <button type="button" className={`${secondaryButton} mt-3`} onClick={retryCompletion}>
                Retry submission
              </button>
            </div>
          )}
        </article>
      </TestShell>
    );
  }

  const preparing = phase === "preparation";
  const recording = phase === "recording" || phase === "finalizing";
  const recordingRemaining = recording
    ? Math.max(0, currentQuestion.recordingDuration - recDuration)
    : currentQuestion.recordingDuration;

  return (
    <TestShell
      title={screenTitle}
      action={
        <button
          type="button"
          className={ghostButton}
          onClick={() => setShowLeaveDialog(true)}
          disabled={abandonPending || recordingMutationPending}
        >
          Leave assessment
        </button>
      }
    >
      <section aria-labelledby="stage-head">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-5">
          <h2 id="stage-head" className="m-0 text-[22px] font-semibold">
            {slotLabel(currentQuestion.category)}
          </h2>
          <div
            className="flex items-center gap-2"
            role="img"
            aria-label={`Answer ${currentQuestionIndex + 1} of ${totalQuestions}`}
          >
            {questions.map((q, i) => (
              <span
                key={q.id}
                className={cn(
                  "h-1.5 w-8 rounded-full transition-colors",
                  i === currentQuestionIndex ? "bg-sn-fg" : i < currentQuestionIndex ? "bg-sn-ink-green" : "bg-sn-border",
                )}
              />
            ))}
          </div>
        </div>

        <div className="grid items-start gap-x-8 min-[921px]:grid-cols-[minmax(0,1fr)_320px] min-[921px]:grid-rows-[auto_1fr]">
          <div className="min-[921px]:col-start-1 min-[921px]:row-start-1">
            <PromptDisplay
              questionNumber={currentQuestionIndex + 1}
              totalQuestions={totalQuestions}
              audioUrl={currentQuestion.audioUrl}
              tasks={currentQuestion.tasks}
              cueCard={currentQuestion.cueCard}
              options={currentQuestion.options}
              autoPlay
              playsLeft={playsLeft}
              onPlayStarted={handlePromptPlayStarted}
              audioLocked={!preparing}
              onAudioEnded={handlePromptAudioEnded}
            />
            {currentQuestion.category === "PART_2" && (
              <p className="mt-4 mb-0 text-[15px] text-sn-muted">
                You may make brief notes on paper during preparation.
              </p>
            )}
          </div>

          <WebcamPreview
            stream={stream}
            status={recording ? "recording" : "standby"}
            className="mt-5 max-w-[360px] max-[640px]:max-w-none min-[921px]:sticky min-[921px]:top-[88px] min-[921px]:col-start-2 min-[921px]:row-span-2 min-[921px]:row-start-1 min-[921px]:mt-0 min-[921px]:max-w-none"
          />

          <div className="min-[921px]:col-start-1 min-[921px]:row-start-2">
            <SlotTimers
              prepRemaining={preparing ? prepCountdown.seconds : 0}
              recordingRemaining={recordingRemaining}
              preparing={preparing}
              recording={recording}
            />
            {preparing && !prepCountdown.isRunning && (
              <p className="mt-3 mb-0 text-[15px] text-sn-muted">Preparation begins when the question audio ends.</p>
            )}
            <p className="sr-only" aria-live="assertive">
              {recording ? "Recording started." : preparing && prepCountdown.isRunning ? "Preparation started." : ""}
            </p>

            {abandonError && (
              <p className="mt-5 rounded-[10px] bg-sn-field-amber p-4 text-[15px]">
                Could not leave this Assessment: {abandonError}
              </p>
            )}
          </div>
        </div>
      </section>

      <AlertDialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <AlertDialogContent className="max-w-[480px]! gap-0 rounded-2xl bg-sn-surface p-7 font-albert text-sn-fg ring-sn-border">
          <AlertDialogTitle className={`${h3} mb-3`}>Leave the test and go to the dashboard?</AlertDialogTitle>
          <AlertDialogDescription className="mb-3 text-[15px] text-sn-muted">
            Leaving abandons this Submission. Answers already recorded are kept, and you will start a new Assessment next time.
          </AlertDialogDescription>
          <p className="mt-0 mb-5 text-[15px] text-sn-muted">The timer keeps running while this message is open.</p>
          <div className="flex flex-wrap justify-end gap-3">
            <AlertDialogPrimitive.Close className={secondaryButton}>Stay in the test</AlertDialogPrimitive.Close>
            <button
              type="button"
              className={primaryButton}
              disabled={abandonPending}
              onClick={() => {
                setShowLeaveDialog(false);
                void handleAbandonTest();
              }}
            >
              Abandon and leave
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </TestShell>
  );
}

/** SpeakNusa test-runner frame: brand bar, screen title, stage column, footer. */
function TestShell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-sn-bg font-albert text-base leading-[1.55] text-sn-fg antialiased">
      <header className="sticky top-0 z-10 border-b border-sn-border bg-sn-bg/92 backdrop-blur-md">
        <div className={`${container} flex items-center justify-between gap-3 py-3.5`}>
          <span className="text-[17px] font-normal lowercase tracking-[-0.01em] min-[381px]:text-[19px]">
            <b className="font-bold">speak</b>nusa
          </span>
          {action}
        </div>
      </header>
      <main id="content" className={`${container} max-w-[960px]! py-12`}>
        <h1 className={`${meta} mb-6 font-semibold text-sn-fg`}>{title}</h1>
        {children}
      </main>
      <footer className="mt-14 border-t border-sn-border py-14 text-[13px] text-sn-muted">
        <div className={container}>© 2026 SpeakNusa · English speaking assessment</div>
      </footer>
    </div>
  );
}
