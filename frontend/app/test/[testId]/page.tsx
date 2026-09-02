"use client";

import { useEffect, useState, useCallback, use, useRef, useReducer } from "react";
import { useAssessmentStart } from "@/components/providers/AssessmentStartProvider";
import { useRecording } from "@/hooks/useRecording";
import { useCountdown } from "@/hooks/useCountdown";
import { WebcamPreview } from "@/components/test/WebcamPreview";
import { PromptDisplay } from "@/components/test/PromptDisplay";
import { RecordingTimer } from "@/components/test/RecordingTimer";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { abandonSubmission, completeSubmission } from "@/lib/test-api";
import { initializeTest } from "@/lib/test-initialization";
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
    studentId,
    sessionPending,
    sessionError,
    isLoading: mediaLoading,
  } = useAssessmentStart();

  // Recording
  const { blob, duration: recDuration, error: recError, startRecording, stopRecording, resetRecording } = useRecording();

  // Questions state — fetched from backend
  const [questions, setQuestions] = useState<Prompt[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [mediaRecoveryError, setMediaRecoveryError] = useState<string | null>(null);
  const [abandonPending, setAbandonPending] = useState(false);
  const [abandonError, setAbandonError] = useState<string | null>(null);

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
        const message = err instanceof Error ? err.message : "Failed to initialize Assessment";
        setFetchError(message);
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
    sessionStorage.removeItem("fluentcheck_hardware_passed");
    sessionStorage.removeItem("fluentcheck_hardware_video");
    clearAssessmentStartIntent();
    window.location.href = "/dashboard";
  };

  const handleAbandonTest = async () => {
    if (!submissionId || abandonPending || !window.confirm("Leave this Assessment? Your current Submission will be abandoned.")) {
      return;
    }
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
    "Enable camera and microphone access to begin.";

  // Loading while the authenticated Student, media, and manifest are prepared.
  if (phase === "loading" && !fetchError && !sessionError && (sessionPending || (Boolean(studentId) && mediaReady))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-studio">
        <div className="text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-studio-text/70" />
          <p className="mt-4 text-studio-text/70">Loading questions...</p>
        </div>
      </div>
    );
  }

  // Error fetching questions
  if (fetchError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-studio p-4">
        <div className="max-w-md text-center">
          <h1 className="mb-4 font-display text-2xl font-medium tracking-tight text-studio-text">
            Failed to load test
          </h1>
          <p className="mb-2 text-studio-text/70">{fetchError}</p>
          <p className="mb-6 text-sm text-studio-text/60">
            Please check your connection and try again.
          </p>
          <Button
            variant="invert"
            size="lg"
            className="w-full"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // Direct navigation or a full reload has no stream to inherit from the
  // dashboard. Request it only from this explicit user action.
  if (sessionError || (!sessionPending && !studentId)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-studio p-4">
        <div className="max-w-md text-center">
          <h1 className="mb-4 font-display text-2xl font-medium tracking-tight text-studio-text">
            Session unavailable
          </h1>
          <p className="mb-6 text-studio-text/70">Please sign in again before starting an Assessment.</p>
          <Button variant="invert" size="lg" className="w-full" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "loading" && !mediaReady && !fetchError && !sessionPending && studentId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-studio p-4">
        <div className="max-w-md text-center">
          <h1 className="mb-4 font-display text-2xl font-medium tracking-tight text-studio-text">
            Camera & Microphone Required
          </h1>
          <p className="mb-6 text-studio-text/70">
            This Assessment needs access to your webcam and microphone to record your responses.
          </p>
          <div className="mb-6 border border-studio-rule bg-studio-panel p-4 text-left text-sm text-studio-text/70">
            <p className="mb-2 font-medium text-studio-text/80">Hardware status:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Webcam: {isVideoReady ? "ready" : videoError || "not ready"}</li>
              <li>Microphone: {isAudioReady ? "ready" : audioError || "not ready"}</li>
              {monitorError && <li>Mic monitor: unavailable; capture can continue</li>}
            </ul>
          </div>
          <Button
            variant="invert"
            size="lg"
            className="w-full"
            onClick={() => void handleRecoverMedia()}
            loading={mediaLoading}
            disabled={mediaLoading}
          >
            Enable camera and microphone
          </Button>
          {mediaRecoveryError && <p className="mt-4 text-sm text-signal">{mediaRecoveryError}</p>}
        </div>
      </div>
    );
  }

  if (phase === "media-paused") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-studio p-4">
        <div className="max-w-md text-center">
          <h1 className="mb-4 font-display text-2xl font-medium tracking-tight text-studio-text">
            Camera or microphone disconnected
          </h1>
          <p className="mb-6 text-studio-text/70">
            Your Submission is preserved. Reconnect both devices to repeat the current answer and continue.
          </p>
          <Button
            variant="invert"
            size="lg"
            className="w-full"
            onClick={() => void handleRecoverMedia()}
            loading={mediaLoading}
            disabled={mediaLoading}
          >
            Reconnect devices
          </Button>
          {(mediaRecoveryError || mediaFailureMessage) && (
            <p className="mt-4 text-sm text-signal">{mediaRecoveryError || mediaFailureMessage}</p>
          )}
        </div>
      </div>
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
      <div className="flex min-h-screen items-center justify-center bg-studio p-4">
        <div className="w-full max-w-lg text-center">
          <div className="mb-6">
            {!allDone && (
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/15">
                <Loader2 className="mx-auto size-10 animate-spin text-studio-text/70" />
              </div>
            )}
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-studio-text/50">
              All answers submitted
            </p>
            <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-studio-text">
              Test complete.
            </h1>
            <p className="mt-2 text-studio-text/70">
              You have answered all {totalQuestions} questions.
            </p>
            {!allDone && !completionError && (
              <p className="mt-2 text-sm text-amber-400">
                {completionPending
                  ? "Finalizing your submission..."
                  : `Uploading ${pendingUploadsCount} remaining video${pendingUploadsCount !== 1 ? "s" : ""}...`}
              </p>
            )}
            {failedUploadsCount > 0 && (
              <p className="mt-2 text-sm text-signal">
                {failedUploadsCount} upload{failedUploadsCount !== 1 ? "s" : ""} failed. Please retry or contact support.
              </p>
            )}
            {completionError && (
              <div className="mt-2 border border-signal/30 bg-signal/10 p-3 text-sm text-signal">
                <p>Could not finalize this submission: {completionError}</p>
                <Button className="mt-3" variant="outline" onClick={retryCompletion}>Retry submission</Button>
              </div>
            )}
          </div>
          <div className="mb-8 border border-studio-rule bg-studio-panel p-6">
            <div className="grid grid-cols-2 gap-4 text-left">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-studio-text/50">
                  Questions answered
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-studio-text">
                  {completedQuestions.length}
                </p>
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-studio-text/50">
                  Recordings
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-studio-text">
                  {completedQuestions.length}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Button
              variant="invert"
              size="lg"
              className="w-full"
              onClick={handleFinishTest}
              disabled={!allDone}
            >
              {allDone ? "Return to dashboard" : `Uploading (${pendingUploadsCount} remaining)...`}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const uploadStatus = currentQuestion ? getUploadStatus(uploadStates[currentQuestion.id]) : "idle";
  const uploadStatusText = getUploadStatusText(uploadStatus);

  return (
    <div className="flex min-h-screen flex-col bg-studio">
      {/* Top bar — question progress dots + upload indicators */}
      <div className="flex items-center justify-between border-b border-studio-rule px-6 py-4">
        <div className="flex items-center gap-2">
          {questions.map((q, i) => {
            const status = getUploadStatus(uploadStates[q.id]);
            let dotColor = "bg-studio-rule";
            if (i === currentQuestionIndex) dotColor = "bg-signal";
            else if (completedQuestions.includes(q.id)) {
              if (status === "uploaded") dotColor = "bg-verified";
              else if (status === "error") dotColor = "bg-signal";
              else if (status === "uploading" || status === "getting-url") dotColor = "bg-amber-500";
              else dotColor = "bg-verified";
            }
            return (
              <div
                key={q.id}
                className={`h-1.5 w-8 rounded-[1px] transition-colors ${dotColor}`}
                title={`Upload: ${status}`}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-4">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-studio-text/50">
            Question {currentQuestionIndex + 1} of {totalQuestions}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleAbandonTest()}
            disabled={abandonPending || phase === "recording" || recordingMutationPending}
            loading={abandonPending}
          >
            Leave assessment
          </Button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left side — webcam preview */}
        <div className="flex flex-1 flex-col items-center justify-center p-4 lg:p-8">
          <div className="w-full max-w-3xl">
            <WebcamPreview
              stream={stream}
              isRecording={phase === "recording"}
              className="aspect-video w-full border border-studio-rule"
            />
          </div>
        </div>

        {/* Right side — question, timer, controls */}
        <div className="flex w-full flex-col justify-center border-t border-studio-rule bg-studio-panel/60 p-6 lg:w-96 lg:border-l lg:border-t-0 lg:p-8">
          <div className="space-y-6">
            {/* Prompt display */}
            <PromptDisplay
              questionNumber={currentQuestionIndex + 1}
              totalQuestions={totalQuestions}
              audioUrl={currentQuestion.audioUrl}
              tasks={currentQuestion.tasks}
              autoPlay
              onAudioEnded={handlePromptAudioEnded}
            />

            {/* Timer section */}
            <div className="border border-studio-rule bg-studio-panel p-5">
              {phase === "preparation" && (
                <div className="text-center">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400">
                    Preparation time
                  </p>
                  <p className="mt-2 font-mono text-5xl font-semibold tabular-nums text-studio-text">
                    {prepCountdown.formatted}
                  </p>
                  <p className="mt-2 text-sm text-studio-text/60">
                    Prepare your answer. Recording will start automatically.
                  </p>
                </div>
              )}
              {phase === "recording" && (
                <RecordingTimer
                  elapsed={recDuration}
                  maxSeconds={currentQuestion.recordingDuration}
                />
              )}
              {phase === "stopped" && (
                <div className="text-center">
                  <div className="mb-2 inline-flex items-center gap-2 border border-verified/40 px-3 py-1">
                    <svg className="h-4 w-4 text-verified" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-verified">
                      Recording saved
                    </span>
                  </div>
                  <p className="text-sm text-studio-text/60">
                    Duration: {Math.floor(recDuration / 60)}:{(recDuration % 60).toString().padStart(2, "0")}
                  </p>
                  {/* Upload status indicator */}
                  {uploadStatusText && (
                    <div className={`mt-2 text-xs ${
                      uploadStatus === "error" ? "text-signal" :
                      uploadStatus === "uploaded" ? "text-verified" :
                      "text-amber-400"
                    }`}>
                      {uploadStatus === "uploading" || uploadStatus === "getting-url" ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="size-4 animate-spin" />
                          {uploadStatusText}
                        </span>
                      ) : (
                        uploadStatusText
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Error display */}
            {recError && (
              <div className="border border-signal/30 bg-signal/10 p-3 text-sm text-signal">
                {recError}
              </div>
            )}

            {/* Upload error — show retry with actual error message */}
            {uploadStatus === "error" && phase === "stopped" && (
              <div className="border border-signal/30 bg-signal/10 p-3 text-sm text-signal">
                <p className="font-medium">Upload failed</p>
                <p className="mt-1 text-xs text-signal/80">
                  {currentQuestion && getUploadError(uploadStates[currentQuestion.id])}
                </p>
                <p className="mt-2 text-xs">You can re-record this question and try again.</p>
              </div>
            )}

            {abandonError && (
              <div className="border border-signal/30 bg-signal/10 p-3 text-sm text-signal">
                Could not leave this Assessment: {abandonError}
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-3">
              {phase === "preparation" && (
                <>
                  <Button
                    variant="invert"
                    size="lg"
                    className="w-full"
                    onClick={handleStartRecording}
                  >
                    Start recording
                  </Button>
                  <p className="text-center text-xs text-studio-text/50">
                    Recording will auto-start in {prepCountdown.seconds}s
                  </p>
                </>
              )}
              {phase === "recording" && (
                <Button
                  variant="destructive"
                  size="lg"
                  className="w-full"
                  onClick={handleStopRecording}
                >
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm bg-studio-text" />
                    Stop answering
                  </span>
                </Button>
              )}
              {phase === "stopped" && (
                <div className="space-y-2">
                  <Button
                    variant="invert"
                    size="lg"
                    className="w-full"
                    onClick={handleNextQuestion}
                    disabled={!canAdvanceFromEntry(currentQuestion?.id, uploadStates)}
                  >
                    {currentQuestionIndex < totalQuestions - 1
                      ? "Next question"
                      : "Finish test"}
                  </Button>
                  {uploadStatus === "error" && (
                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full"
                      onClick={() => retryUpload(currentQuestion.id)}
                    >
                      Re-record this question
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
