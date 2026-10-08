"use client";

import { useEffect, useState, useCallback, use, useRef, useReducer } from "react";
import { useAssessmentStart } from "@/components/providers/AssessmentStartProvider";
import { useRecording } from "@/hooks/useRecording";
import { useCountdown } from "@/hooks/useCountdown";
import { WebcamPreview } from "@/components/test/WebcamPreview";
import { PromptDisplay } from "@/components/test/PromptDisplay";
import { RecordingTimer } from "@/components/test/RecordingTimer";
import { TimerRing } from "@/components/test/TimerRing";
import { formatClock } from "@/components/QuestionAudioPlayer";
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
import {
  areAllManifestEntriesUploaded,
  canAdvanceFromEntry,
  initializeUploadStates,
  uploadStatusLabel,
} from "@/lib/recording-upload-state";
import { entryMachinesReducer } from "@/lib/recording-state-machine";

type TestPhase = "loading" | "preparation" | "recording" | "stopped" | "media-paused" | "completed";

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
    micLevel,
    studentId,
    sessionPending,
    sessionError,
    isLoading: mediaLoading,
  } = useAssessmentStart();

  // Recording
  const { blob, duration: recDuration, error: recError, startRecording, stopRecording, resetRecording } = useRecording();

  // Questions state — fetched from backend
  const [questions, setQuestions] = useState<Prompt[]>([]);
  const [fetchError, setFetchError] = useState<{
    message: string;
    isSubmissionConflict: boolean;
  } | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [mediaRecoveryError, setMediaRecoveryError] = useState<string | null>(null);
  const [abandonPending, setAbandonPending] = useState(false);
  const [abandonError, setAbandonError] = useState<string | null>(null);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);

  // Question phase
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<TestPhase>("loading");
  const [completedQuestions, setCompletedQuestions] = useState<string[]>([]);
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const [pendingUploadTrigger, setPendingUploadTrigger] = useState<{
    qId: string;
    durationSeconds: number;
  } | null>(null);

  // Upload state per question
  const [uploadStates, setUploadStates] = useState<UploadState>({});
  const [, dispatchEntryMachine] = useReducer(entryMachinesReducer, {});
  const getUploadStatus = (state: QuestionUploadState | undefined): UploadStatus => state?.status ?? "idle";
  const getUploadError = (state: QuestionUploadState | undefined): string | undefined => state?.error;
  // Ref to track uploads in progress (avoid stale closure issues)
  const uploadRef = useRef<Map<string, Promise<void>>>(new Map());
  const uploadStatesRef = useRef(uploadStates);
  const blobRef = useRef<Blob | null>(null);
  const submissionIdRef = useRef<string | null>(null);
  const questionsRef = useRef<Prompt[]>([]);

  useEffect(() => {
    uploadStatesRef.current = uploadStates;
    blobRef.current = blob;
    submissionIdRef.current = submissionId;
    questionsRef.current = questions;
  }, [blob, questions, submissionId, uploadStates]);

  // Guard against React StrictMode double-mount in dev mode
  const initCalled = useRef(false);

  const currentQuestion = questions[currentQuestionIndex];
  const totalQuestions = questions.length;
  const currentUploadStatus = currentQuestion ? getUploadStatus(uploadStates[currentQuestion.id]) : "idle";
  const recordingMutationPending = ["finalizing", "signing", "getting-url", "uploading", "verifying"].includes(currentUploadStatus);

  // Fetch questions + create/replay the Submission only after media is ready.
  useEffect(() => {
    if (initCalled.current || sessionPending || !studentId || !mediaReady) return;
    initCalled.current = true;

    const init = async () => {
      try {
        const initialized = await initializeTest(studentId);
        setSubmissionId(initialized.submissionId);
        setQuestions(initialized.questions);
        setUploadStates(initializeUploadStates(
          initialized.questions.map((question) => question.id),
          initialized.uploadedEntryIds,
        ));
      } catch (err) {
        const isSubmissionConflict = err instanceof ApiError && err.statusCode === 409;
        const message = err instanceof Error ? err.message : "Failed to initialize Assessment";
        setFetchError({ message, isSubmissionConflict });
      }
    };

    init();
  }, [mediaReady, sessionPending, studentId]);

  // Countdown for preparation
  const onPrepComplete = useCallback(() => {
    if (stream && mediaReady && phase === "preparation") {
      startRecording(stream, currentQuestion?.recordingDuration);
      setPhase("recording");
    }
  }, [stream, mediaReady, phase, startRecording, currentQuestion]);

  const prepCountdown = useCountdown(currentQuestion?.prepTime || 30, onPrepComplete);

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

  useEffect(() => {
    if (!mediaReady && (phase === "preparation" || phase === "recording" || phase === "stopped")) {
      prepCountdown.pause();
      resetRecording();
      // Media loss invalidates the pending blob-to-entry association.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingUploadTrigger(null);
      // Media readiness is an external subscription boundary; pause the
      // recording UI as soon as the coordinator reports track loss.
      setPhase("media-paused");
      setMediaRecoveryError(null);
    }
    if (mediaReady && phase === "media-paused") {
      setMediaRecoveryError(null);
      prepCountdown.reset();
      setPhase("preparation");
    }
  }, [mediaReady, phase, prepCountdown, resetRecording]);

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

  // Audio questions start preparation when the prompt finishes. Questions
  // without audio start immediately so they cannot leave the test waiting.
  useEffect(() => {
    if (phase === "preparation") {
      prepCountdown.reset();
      if (!currentQuestion?.audioUrl) {
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

  // Track whether we've already called completeSubmission
  const [submissionCompleted, setSubmissionCompleted] = useState(false);

  async function startUpload(
    questionId: string,
    videoBlob: Blob,
    durationSeconds: number,
  ) {
    // If already uploading or uploaded, or no submissionId yet, skip
    if (uploadRef.current.has(questionId)) return;

    const currentSubmissionId = submissionIdRef.current;
    if (!currentSubmissionId) return;

    setUploadStates((prev) => ({ ...prev, [questionId]: { status: "signing" } }));
    dispatchEntryMachine({ entryId: questionId, event: { type: "UPLOAD_STARTED" } });

    const uploadPromise = (async () => {
      try {
        // Step 1: Get presigned URL from backend
        const { presignedUrl } = await getPresignedUrl(
          currentSubmissionId,
          questionId,
          videoBlob.type || "video/webm"
        );

        // Step 2: Upload directly to R2
        setUploadStates((prev) => ({ ...prev, [questionId]: { status: "uploading" } }));
        dispatchEntryMachine({ entryId: questionId, event: { type: "SIGNED" } });
        await uploadToR2(presignedUrl, videoBlob);

        // Step 3: Confirm upload to backend. This is the server verification phase.
        setUploadStates((prev) => ({ ...prev, [questionId]: { status: "verifying" } }));
        dispatchEntryMachine({ entryId: questionId, event: { type: "UPLOAD_FINISHED" } });
        const sizeBytes = videoBlob.size;
        await confirmUpload(currentSubmissionId, questionId, { sizeBytes, durationSeconds });

        // Step 4: Mark as uploaded
        setUploadStates((prev) => ({ ...prev, [questionId]: { status: "uploaded" } }));
        dispatchEntryMachine({ entryId: questionId, event: { type: "VERIFIED" } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        console.error("Upload error for question", questionId, err);
        setUploadStates((prev) => ({ ...prev, [questionId]: { status: "error", error: message } }));
        dispatchEntryMachine({ entryId: questionId, event: { type: "FAILED", message } });
      } finally {
        uploadRef.current.delete(questionId);
      }
    })();

    uploadRef.current.set(questionId, uploadPromise);
  }

  // Watch for recording auto-stop (duration reached max, triggered inside useRecording)
  useEffect(() => {
    const currentBlob = blobRef.current;
    if (phase === "recording" && currentBlob && currentBlob.size > 0) {
      setPhase("stopped");
      const qId = currentQuestion?.id;
      if (qId) {
        // The blob arrives from MediaRecorder's asynchronous onstop callback.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPendingUploadTrigger({ qId, durationSeconds: recDuration });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, phase]);

  // Derive whether all uploads are done from the current upload states
  const allUploaded = areAllManifestEntriesUploaded(
    questions.map((question) => question.id),
    uploadStates,
  );

  // When on the completion screen and all uploads finish, mark submission as complete
  useEffect(() => {
    if (!showCompletion || !allUploaded || submissionCompleted || completionPending || completionError) return;
    const sid = submissionIdRef.current;
    if (!sid) return;

    setCompletionPending(true);
    setCompletionError(null);
    completeSubmission(sid)
      .then(() => setSubmissionCompleted(true))
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Failed to complete submission";
        setCompletionError(message);
      })
      .finally(() => setCompletionPending(false));
  }, [showCompletion, allUploaded, submissionCompleted, completionPending, completionError]);

  // Upload tracking — when a new question finishes recording and blob becomes available, start upload
  // The durationSeconds is captured at stop-time so it isn't lost if resetRecording() zeroes the hook duration.
  useEffect(() => {
    if (!pendingUploadTrigger) return;
    const { qId, durationSeconds } = pendingUploadTrigger;
    const currentBlob = blobRef.current;
    if (!currentBlob) return; // blob not ready yet — will be retriggered by state change

    const state = getUploadStatus(uploadStatesRef.current[qId]);
    if (state === "uploaded" || state === "uploading" || state === "verifying" || state === "signing") return;

    if (currentBlob.size === 0) {
      setUploadStates((prev) => ({ ...prev, [qId]: { status: "error", error: "Recording was empty. Please try again." } }));
      setPendingUploadTrigger(null);
      return;
    }
    setUploadStates((prev) => ({ ...prev, [qId]: { status: "blob-ready" } }));

    startUpload(qId, currentBlob, durationSeconds);
    setPendingUploadTrigger(null);
  }, [pendingUploadTrigger, blob]);

  const retryUpload = useCallback((questionId: string) => {
    setUploadStates((prev) => ({ ...prev, [questionId]: { status: "idle" } }));
    // The blob is no longer available at this point, so we need the user to re-record
    // Reset the question state so they can re-record
    setCompletedQuestions((prev) => prev.filter((id) => id !== questionId));
    setCurrentQuestionIndex(questions.findIndex((q) => q.id === questionId));
    resetRecording();
    prepCountdown.reset();
    setPhase("preparation");
  }, [questions, resetRecording, prepCountdown]);

  const getUploadStatusText = (status: UploadStatus): string | null => uploadStatusLabel(status);

  const handleStartRecording = () => {
    if (stream && mediaReady) {
      prepCountdown.pause();
      startRecording(stream, currentQuestion?.recordingDuration);
      setPhase("recording");
    }
  };

  const handleStopRecording = () => {
    stopRecording(); // MediaRecorder finalizes asynchronously; the upload effect waits for blob-ready.
    setPhase("stopped");

    const qId = currentQuestion?.id;
    if (qId) {
      setPendingUploadTrigger({ qId, durationSeconds: recDuration });
    }
  };

  const handleNextQuestion = () => {
    if (!canAdvanceFromEntry(currentQuestion?.id, uploadStatesRef.current)) return;
    setCompletedQuestions((prev) => [...prev, currentQuestion.id]);
    resetRecording();
    prepCountdown.reset();

    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      setPhase("preparation");
    } else {
      setShowCompletion(true);
      setPhase("completed");
    }
  };

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

  // Error fetching questions
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
          Your Submission is preserved. Reconnect both devices to repeat the current answer and continue.
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

  // Completion screen
  if (showCompletion) {
    const pendingUploadsCount = Object.entries(uploadStates).filter(
      ([, s]) => {
        const st = getUploadStatus(s);
        return st === "uploading" || st === "getting-url";
      }
    ).length;
    const failedUploadsCount = Object.entries(uploadStates).filter(
      ([, s]) => getUploadStatus(s) === "error"
    ).length;
    const allDone = allUploaded && failedUploadsCount === 0 && submissionCompleted;

    return (
      <TestShell>
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <h2 className={h2}>{allDone ? "All answers are submitted" : "Finishing your test"}</h2>
            <p className={`${meta} mt-2`}>
              {allDone ? "Session complete · ready for scoring" : "Keep this page open"}
            </p>
          </div>
          {allDone && <Pill tone="green">Session complete</Pill>}
        </div>
        <article className={`${card} mt-5`}>
          <div className="flex flex-col">
            {questions.map((q, i) => {
              const st = getUploadStatus(uploadStates[q.id]);
              return (
                <div key={q.id} className="grid grid-cols-[1fr_auto] items-center gap-5 border-t border-sn-border py-5 first:border-t-0 first:pt-0">
                  <h3 className="text-[17px] font-semibold">
                    Question {i + 1} · {slotLabel(q.category)}
                  </h3>
                  {st === "uploaded" ? (
                    <Pill tone="green">Uploaded</Pill>
                  ) : st === "error" ? (
                    <Pill tone="clay">Failed</Pill>
                  ) : (
                    <Pill>{uploadStatusLabel(st) ?? "Waiting"}</Pill>
                  )}
                </div>
              );
            })}
          </div>
          {!allDone && !completionError && (
            <p className="mt-5 flex items-center gap-2 text-[15px] text-sn-muted" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {completionPending
                ? "Finalizing your submission…"
                : `Uploading ${pendingUploadsCount} remaining video${pendingUploadsCount !== 1 ? "s" : ""}…`}
            </p>
          )}
          {failedUploadsCount > 0 && (
            <p className="mt-5 text-[15px] text-sn-danger">
              {failedUploadsCount} upload{failedUploadsCount !== 1 ? "s" : ""} failed. Please retry or contact support.
            </p>
          )}
          {completionError && (
            <div className="mt-5 rounded-[10px] bg-sn-field-amber p-4 text-[15px]">
              <p className="m-0">Could not finalize this submission: {completionError}</p>
              <button type="button" className={`${secondaryButton} mt-3`} onClick={retryCompletion}>
                Retry submission
              </button>
            </div>
          )}
          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-sn-border pt-5">
            <button type="button" className={primaryButton} onClick={handleFinishTest} disabled={!allDone}>
              {allDone ? "Return to dashboard" : `Uploading (${pendingUploadsCount} remaining)...`}
            </button>
          </div>
        </article>
      </TestShell>
    );
  }

  const uploadStatus = currentQuestion ? getUploadStatus(uploadStates[currentQuestion.id]) : "idle";
  const uploadStatusText = getUploadStatusText(uploadStatus);
  const leaveDisabled = abandonPending || phase === "recording" || recordingMutationPending;

  return (
    <TestShell
      action={
        <button
          type="button"
          className={ghostButton}
          onClick={() => setShowLeaveDialog(true)}
          disabled={leaveDisabled}
        >
          Leave assessment
        </button>
      }
    >
      <section aria-labelledby="stage-head">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-5">
          <p id="stage-head" className={meta}>
            Question {currentQuestionIndex + 1} of {totalQuestions}
            {currentQuestion && <> · {slotLabel(currentQuestion.category)}</>}
          </p>
          <div className="flex items-center gap-2" aria-label="Progress">
            {questions.map((q, i) => {
              const status = getUploadStatus(uploadStates[q.id]);
              const done = completedQuestions.includes(q.id);
              return (
                <span
                  key={q.id}
                  title={`Upload: ${status}`}
                  className={cn(
                    "h-1.5 w-8 rounded-full transition-colors",
                    i === currentQuestionIndex
                      ? "bg-sn-fg"
                      : done && status === "error"
                        ? "bg-sn-danger"
                        : done
                          ? "bg-sn-ink-green"
                          : "bg-sn-border",
                  )}
                />
              );
            })}
            <span className="ml-2 rounded-full bg-sn-fg/6 px-2.5 py-1 text-[11px] uppercase tracking-[0.04em] whitespace-nowrap text-sn-muted">
              Prep {currentQuestion.prepTime} s · speak {currentQuestion.recordingDuration} s
            </span>
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
              onAudioEnded={handlePromptAudioEnded}
            />
          </div>

          <WebcamPreview
            stream={stream}
            status={phase === "recording" ? "recording" : phase === "stopped" ? "saved" : "standby"}
            className="mt-5 max-w-[360px] max-[640px]:max-w-none min-[921px]:sticky min-[921px]:top-[88px] min-[921px]:col-start-2 min-[921px]:row-span-2 min-[921px]:row-start-1 min-[921px]:mt-0 min-[921px]:max-w-none"
          />

          <div className="min-[921px]:col-start-1 min-[921px]:row-start-2">
            {phase === "preparation" && (
              <TimerRing
                remaining={prepCountdown.seconds}
                total={currentQuestion.prepTime}
                title="Preparation"
              >
                <p className="mt-3 mb-0 max-w-[44ch] text-[15px] text-sn-muted">
                  {prepCountdown.isRunning
                    ? "Use this time to plan. Recording starts automatically when preparation ends."
                    : "Preparation begins as soon as the question audio ends."}
                </p>
              </TimerRing>
            )}
            {phase === "recording" && (
              <RecordingTimer elapsed={recDuration} maxSeconds={currentQuestion.recordingDuration}>
                <div className="mt-3.5 flex h-[34px] items-center gap-[5px]" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 rounded-[3px] bg-sn-fg transition-[height] duration-75"
                      style={{ height: `${Math.max(18, Math.min(100, micLevel * (0.6 + ((i * 37) % 5) / 6)))}%` }}
                    />
                  ))}
                </div>
                <p className={`${meta} mt-2.5`}>Input level · on-device monitor</p>
              </RecordingTimer>
            )}
            {phase === "stopped" && (
              <div className="mt-5 flex flex-wrap items-center gap-5">
                <Pill tone={uploadStatus === "error" ? "clay" : uploadStatus === "uploaded" ? "green" : "plain"}>
                  {uploadStatus === "error" ? "Upload failed" : "Recording saved"}
                </Pill>
                <p className="m-0 text-[15px]">
                  Take captured · <span className="tabular-nums">{formatClock(recDuration)}</span>
                  {uploadStatusText && uploadStatus !== "error" && (
                    <span className="text-sn-muted"> · {uploadStatusText}</span>
                  )}
                </p>
              </div>
            )}

            {recError && (
              <p className="mt-5 rounded-[10px] bg-sn-field-amber p-4 text-[15px]">{recError}</p>
            )}

            {uploadStatus === "error" && phase === "stopped" && (
              <div className="mt-5 rounded-[10px] bg-sn-field-amber p-4 text-[15px]">
                <p className="m-0 font-medium">Upload failed</p>
                <p className="mt-1 mb-0 text-sm text-sn-muted">
                  {currentQuestion && getUploadError(uploadStates[currentQuestion.id])}
                </p>
                <p className="mt-2 mb-0 text-sm">You can re-record this question and try again.</p>
              </div>
            )}

            {abandonError && (
              <p className="mt-5 rounded-[10px] bg-sn-field-amber p-4 text-[15px]">
                Could not leave this Assessment: {abandonError}
              </p>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-sn-border pt-5">
              {phase === "preparation" && (
                <>
                  <p className={`${meta} mr-auto`}>Recording will auto-start in {prepCountdown.seconds}s</p>
                  <button type="button" className={primaryButton} onClick={handleStartRecording}>
                    Start recording
                  </button>
                </>
              )}
              {phase === "recording" && (
                <button type="button" className={secondaryButton} onClick={handleStopRecording}>
                  <span className="size-3 rounded-sm bg-sn-fg" aria-hidden="true" />
                  Stop answering
                </button>
              )}
              {phase === "stopped" && (
                <>
                  {uploadStatus === "error" && (
                    <button type="button" className={secondaryButton} onClick={() => retryUpload(currentQuestion.id)}>
                      Re-record this question
                    </button>
                  )}
                  <button
                    type="button"
                    className={primaryButton}
                    onClick={handleNextQuestion}
                    disabled={!canAdvanceFromEntry(currentQuestion?.id, uploadStates)}
                  >
                    {currentQuestionIndex < totalQuestions - 1 ? "Next question" : "Finish test"}
                  </button>
                </>
              )}
            </div>
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

/** SpeakNusa test-runner frame: brand bar, narrow stage column, footer. */
function TestShell({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-sn-bg font-albert text-base leading-[1.55] text-sn-fg antialiased">
      <header className="sticky top-0 z-10 border-b border-sn-border bg-sn-bg/92 backdrop-blur-md">
        <div className={`${container} flex items-center justify-between gap-3 py-3.5`}>
          <span className="inline-flex items-baseline gap-2">
            <span className="text-[17px] font-normal lowercase tracking-[-0.01em] min-[381px]:text-[19px]">
              <b className="font-bold">speak</b>nusa
            </span>
            <span className={meta}>Test runner</span>
          </span>
          {action}
        </div>
      </header>
      <main id="content" className={`${container} max-w-[960px]! py-12`}>
        {children}
      </main>
      <footer className="mt-14 border-t border-sn-border py-14 text-[13px] text-sn-muted">
        <div className={container}>© 2026 SpeakNusa · English speaking assessment</div>
      </footer>
    </div>
  );
}
