"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useRecording } from "@/hooks/useRecording";
import { useCountdown } from "@/hooks/useCountdown";
import { WebcamPreview } from "@/components/test/WebcamPreview";
import { PromptDisplay } from "@/components/test/PromptDisplay";
import { RecordingTimer } from "@/components/test/RecordingTimer";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { fetchQuestions, createSubmission, completeSubmission } from "@/lib/test-api";
import { getPresignedUrl, uploadToR2, confirmUpload } from "@/lib/upload-api";
import type { Prompt, UploadStatus, QuestionUploadState } from "@/types/test";

type TestPhase = "loading" | "preparation" | "recording" | "stopped" | "completed";

type UploadState = Record<string, QuestionUploadState>;

export default function TestPage({ params }: { params: Promise<{ testId: string }> }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { testId } = use(params);
  const router = useRouter();

  // Stream management — hardware check already granted permissions
  const { stream, requestPermissions, stopStream } = useMediaDevices();
  const [streamReady, setStreamReady] = useState(false);
  const [initError, setInitError] = useState(false);

  // Recording
  const { blob, duration: recDuration, error: recError, startRecording, stopRecording, resetRecording } = useRecording();

  // Questions state — fetched from backend
  const [questions, setQuestions] = useState<Prompt[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  // Question phase
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<TestPhase>("loading");
  const [completedQuestions, setCompletedQuestions] = useState<string[]>([]);
  const [showCompletion, setShowCompletion] = useState(false);

  // Upload state per question
  const [uploadStates, setUploadStates] = useState<UploadState>({});
  const getUploadStatus = (state: QuestionUploadState | undefined): UploadStatus => state?.status ?? "idle";
  const getUploadError = (state: QuestionUploadState | undefined): string | undefined => state?.error;
  // Ref to track uploads in progress (avoid stale closure issues)
  const uploadRef = useRef<Map<string, Promise<void>>>(new Map());
  const uploadStatesRef = useRef(uploadStates);
  uploadStatesRef.current = uploadStates;
  const blobRef = useRef<Blob | null>(null);
  blobRef.current = blob;
  const submissionIdRef = useRef<string | null>(null);
  submissionIdRef.current = submissionId;
  const recDurationRef = useRef(0);
  recDurationRef.current = recDuration;
  const questionsRef = useRef<Prompt[]>([]);
  questionsRef.current = questions;

  const currentQuestion = questions[currentQuestionIndex];
  const totalQuestions = questions.length;

  // Fetch questions + create submission on mount
  useEffect(() => {
    const init = async () => {
      try {
        // Create submission first
        const subId = await createSubmission();
        setSubmissionId(subId);

        // Then fetch questions
        const data = await fetchQuestions();
        const mapped: Prompt[] = data.map((q) => ({
          id: q.id,
          text: q.promptText,
          tasks: q.tasks.map((t) => t.promptText),
          task: q.tasks.map((t) => t.promptText).join("\n"),
          prepTime: q.preparationSeconds,
          recordingDuration: q.recordingSeconds,
          order: q.order,
        }));
        setQuestions(mapped);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to initialize test";
        setFetchError(message);
      }
    };

    init();
  }, []);

  // Countdown for preparation
  const onPrepComplete = useCallback(() => {
    if (stream && streamReady && phase === "preparation") {
      startRecording(stream);
      setPhase("recording");
    }
  }, [stream, streamReady, phase, startRecording]);

  const prepCountdown = useCountdown(currentQuestion?.prepTime || 30, onPrepComplete);

  // Countdown for recording max duration
  const onRecordingTimeComplete = useCallback(() => {
    stopRecording();
    setPhase("stopped");
  }, [stopRecording]);

  const recCountdown = useCountdown(currentQuestion?.recordingDuration || 120, onRecordingTimeComplete);

  // On mount: request camera & mic permissions directly
  useEffect(() => {
    const initStream = async () => {
      try {
        const success = await requestPermissions();
        setStreamReady(success);
        if (!success) setInitError(true);
      } catch {
        setInitError(true);
      }
    };
    initStream();

    return () => {
      stopStream();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard: stop camera stream on any navigation away from the test page.
  useEffect(() => {
    const handleBeforeUnload = () => {
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
  }, [stopStream]);

  // Transition from loading to preparation once questions and stream are ready
  useEffect(() => {
    if (questions.length > 0 && streamReady && phase === "loading") {
      setPhase("preparation");
    }
  }, [questions, streamReady, phase]);

  // Start preparation countdown when question loads and stream is ready
  useEffect(() => {
    if (phase === "preparation") {
      prepCountdown.start();
    }
    return () => {
      prepCountdown.pause();
      recCountdown.pause();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentQuestionIndex]);

  // Track whether we've already called completeSubmission
  const [submissionCompleted, setSubmissionCompleted] = useState(false);

  // Derive whether all uploads are done from the current upload states
  const allUploaded = Object.values(uploadStates).every((s) => s.status === "uploaded");

  // When on the completion screen and all uploads finish, mark submission as complete
  useEffect(() => {
    if (!showCompletion || !allUploaded || submissionCompleted) return;
    const sid = submissionIdRef.current;
    if (!sid) return;

    setSubmissionCompleted(true);
    completeSubmission(sid).catch((err) => {
      console.error("Failed to complete submission:", err);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompletion, allUploaded]);

  // Upload tracking — when a new question finishes recording and blob becomes available, start upload
  const [pendingUploadTrigger, setPendingUploadTrigger] = useState<{ qId: string } | null>(null);
  useEffect(() => {
    if (!pendingUploadTrigger) return;
    const { qId } = pendingUploadTrigger;
    const currentBlob = blobRef.current;
    if (!currentBlob) return; // blob not ready yet — will be retriggered by state change

    const state = getUploadStatus(uploadStatesRef.current[qId]);
    if (state === "uploaded" || state === "uploading") return;

    startUpload(qId, currentBlob);
    setPendingUploadTrigger(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUploadTrigger]);

  const startUpload = useCallback(async (questionId: string, videoBlob: Blob) => {
    // If already uploading or uploaded, or no submissionId yet, skip
    if (uploadRef.current.has(questionId)) return;

    const currentSubmissionId = submissionIdRef.current;
    if (!currentSubmissionId) return;

    setUploadStates((prev) => ({ ...prev, [questionId]: { status: "getting-url" } }));

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
        await uploadToR2(presignedUrl, videoBlob);

        // Step 3: Confirm upload to backend
        const durationSeconds = recDurationRef.current;
        const sizeBytes = videoBlob.size;
        await confirmUpload(currentSubmissionId, questionId, { sizeBytes, durationSeconds });

        // Step 4: Mark as uploaded
        setUploadStates((prev) => ({ ...prev, [questionId]: { status: "uploaded" } }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        console.error("Upload error for question", questionId, err);
        setUploadStates((prev) => ({ ...prev, [questionId]: { status: "error", error: message } }));
      } finally {
        uploadRef.current.delete(questionId);
      }
    })();

    uploadRef.current.set(questionId, uploadPromise);
  }, []);

  const retryUpload = useCallback((questionId: string) => {
    setUploadStates((prev) => ({ ...prev, [questionId]: { status: "idle" } }));
    // The blob is no longer available at this point, so we need the user to re-record
    // Reset the question state so they can re-record
    setCompletedQuestions((prev) => prev.filter((id) => id !== questionId));
    setCurrentQuestionIndex(questions.findIndex((q) => q.id === questionId));
    resetRecording();
    prepCountdown.reset();
    recCountdown.reset();
    setPhase("preparation");
  }, [questions, resetRecording, prepCountdown, recCountdown]);

  const getUploadStatusText = (status: UploadStatus): string | null => {
    switch (status) {
      case "getting-url":
        return "Preparing upload...";
      case "uploading":
        return "Uploading video...";
      case "uploaded":
        return "Uploaded ✓";
      case "error":
        return "Upload failed";
      default:
        return null;
    }
  };

  const handleStartRecording = () => {
    if (stream) {
      prepCountdown.pause();
      startRecording(stream);
      recCountdown.start();
      setPhase("recording");
    }
  };

  const handleStopRecording = () => {
    stopRecording(); // This schedules onstop asynchronously — blob will be set after
    recCountdown.pause();
    setPhase("stopped");

    // Defer upload trigger so the MediaRecorder onstop fires and blob is available
    const qId = currentQuestion?.id;
    if (qId) {
      setTimeout(() => {
        setPendingUploadTrigger({ qId });
      }, 100);
    }
  };

  const handleNextQuestion = () => {
    setCompletedQuestions((prev) => [...prev, currentQuestion.id]);
    resetRecording();
    prepCountdown.reset();
    recCountdown.reset();

    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      setPhase("preparation");
    } else {
      setShowCompletion(true);
      setPhase("completed");
    }
  };

  const handleFinishTest = () => {
    // Forcefully stop all media tracks synchronously
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    stopStream();
    sessionStorage.removeItem("fluentcheck_hardware_passed");
    sessionStorage.removeItem("fluentcheck_hardware_video");
    window.location.href = "/dashboard";
  };

  // Loading while questions are being fetched and stream initialises
  if (phase === "loading" && !fetchError && !initError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-zinc-400">Loading questions...</p>
        </div>
      </div>
    );
  }

  // Error fetching questions
  if (fetchError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="max-w-md text-center">
          <h1 className="mb-4 text-2xl font-bold text-white">Failed to load test</h1>
          <p className="mb-2 text-zinc-400">{fetchError}</p>
          <p className="mb-6 text-sm text-zinc-500">
            Please check your connection and try again.
          </p>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => window.location.reload()}
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // Error acquiring stream — show retry with troubleshooting tips
  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="max-w-md text-center">
          <h1 className="mb-4 text-2xl font-bold text-white">Camera & Microphone Required</h1>
          <p className="mb-6 text-zinc-400">
            This test needs access to your webcam and microphone to record your responses.
          </p>
          <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left text-sm text-zinc-400">
            <p className="mb-2 font-medium text-zinc-300">Troubleshooting tips:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Allow camera and microphone access in your browser settings</li>
              <li>Make sure no other app is using your camera or mic</li>
              <li>Try refreshing the page</li>
            </ul>
          </div>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => window.location.reload()}
          >
            Try Again
          </Button>
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
    const allDone = allUploaded && failedUploadsCount === 0;

    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="w-full max-w-lg text-center">
          <div className="mb-6">
            <div className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full ${
              allDone ? "bg-emerald-500/20" : "bg-amber-500/20"
            }`}>
              {allDone ? (
                <svg className="h-10 w-10 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              ) : (
                <Spinner size="lg" />
              )}
            </div>
            <h1 className="text-3xl font-bold text-white">Test Complete!</h1>
            <p className="mt-2 text-zinc-400">
              You have answered all {totalQuestions} questions.
            </p>
            {!allDone && (
              <p className="mt-2 text-sm text-amber-400">
                Uploading {pendingUploadsCount} remaining video{pendingUploadsCount !== 1 ? "s" : ""} in background...
              </p>
            )}
            {failedUploadsCount > 0 && (
              <p className="mt-2 text-sm text-red-400">
                {failedUploadsCount} upload{failedUploadsCount !== 1 ? "s" : ""} failed. Please retry or contact support.
              </p>
            )}
          </div>
          <div className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="grid grid-cols-2 gap-4 text-left">
              <div>
                <p className="text-sm text-zinc-500">Questions Answered</p>
                <p className="text-2xl font-bold text-white">{completedQuestions.length}</p>
              </div>
              <div>
                <p className="text-sm text-zinc-500">Recordings</p>
                <p className="text-2xl font-bold text-white">{completedQuestions.length}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleFinishTest}
              disabled={!allDone}
            >
              {allDone ? "Return to Dashboard" : `Uploading (${pendingUploadsCount} remaining)...`}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const uploadStatus = currentQuestion ? getUploadStatus(uploadStates[currentQuestion.id]) : "idle";
  const uploadStatusText = getUploadStatusText(uploadStatus);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      {/* Top bar — question progress dots + upload indicators */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-2">
          {questions.map((q, i) => {
            const status = getUploadStatus(uploadStates[q.id]);
            let dotColor = "bg-zinc-700";
            if (i === currentQuestionIndex) dotColor = "bg-blue-500";
            else if (completedQuestions.includes(q.id)) {
              if (status === "uploaded") dotColor = "bg-emerald-500";
              else if (status === "error") dotColor = "bg-red-500";
              else if (status === "uploading" || status === "getting-url") dotColor = "bg-amber-500";
              else dotColor = "bg-emerald-500";
            }
            return (
              <div
                key={q.id}
                className={`h-2 w-8 rounded-full transition-colors ${dotColor}`}
                title={`Upload: ${status}`}
              />
            );
          })}
        </div>
        <div className="text-sm text-zinc-500">
          Question {currentQuestionIndex + 1} of {totalQuestions}
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
              className="aspect-video w-full shadow-2xl"
            />
          </div>
        </div>

        {/* Right side — question, timer, controls */}
        <div className="flex w-full flex-col justify-center border-t border-zinc-800 bg-zinc-900/50 p-6 lg:w-96 lg:border-l lg:border-t-0 lg:p-8">
          <div className="space-y-6">
            {/* Prompt display */}
            <PromptDisplay
              questionNumber={currentQuestionIndex + 1}
              totalQuestions={totalQuestions}
              text={currentQuestion.text}
              tasks={currentQuestion.tasks}
            />

            {/* Timer section */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              {phase === "preparation" && (
                <div className="text-center">
                  <p className="mb-2 text-sm text-amber-400">Preparation Time</p>
                  <p className="text-4xl font-mono font-bold text-white">
                    {prepCountdown.formatted}
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    Prepare your answer. Recording will start automatically.
                  </p>
                </div>
              )}
              {phase === "recording" && (
                <RecordingTimer
                  seconds={recDuration}
                  maxSeconds={currentQuestion.recordingDuration}
                />
              )}
              {phase === "stopped" && (
                <div className="text-center">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-4 py-1.5">
                    <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <span className="text-sm font-medium text-emerald-500">Recording saved</span>
                  </div>
                  <p className="text-sm text-zinc-500">
                    Duration: {Math.floor(recDuration / 60)}:{(recDuration % 60).toString().padStart(2, "0")}
                  </p>
                  {/* Upload status indicator */}
                  {uploadStatusText && (
                    <div className={`mt-2 text-xs ${
                      uploadStatus === "error" ? "text-red-400" :
                      uploadStatus === "uploaded" ? "text-emerald-400" :
                      "text-amber-400"
                    }`}>
                      {uploadStatus === "uploading" || uploadStatus === "getting-url" ? (
                        <span className="inline-flex items-center gap-1">
                          <Spinner size="sm" />
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
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {recError}
              </div>
            )}

            {/* Upload error — show retry with actual error message */}
            {uploadStatus === "error" && phase === "stopped" && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                <p className="font-medium">Upload failed</p>
                <p className="mt-1 text-xs text-red-300">
                  {currentQuestion && getUploadError(uploadStates[currentQuestion.id])}
                </p>
                <p className="mt-2 text-xs">You can re-record this question and try again.</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-3">
              {phase === "preparation" && (
                <>
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onClick={handleStartRecording}
                  >
                    Start Recording
                  </Button>
                  <p className="text-center text-xs text-zinc-600">
                    Recording will auto-start in {prepCountdown.seconds}s
                  </p>
                </>
              )}
              {phase === "recording" && (
                <Button
                  variant="danger"
                  size="lg"
                  fullWidth
                  onClick={handleStopRecording}
                >
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm bg-white" />
                    Stop Answering
                  </span>
                </Button>
              )}
              {phase === "stopped" && (
                <div className="space-y-2">
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onClick={handleNextQuestion}
                  >
                    {currentQuestionIndex < totalQuestions - 1
                      ? "Next Question"
                      : "Finish Test"}
                  </Button>
                  {uploadStatus === "error" && (
                    <Button
                      variant="outline"
                      size="lg"
                      fullWidth
                      onClick={() => retryUpload(currentQuestion.id)}
                    >
                      Re-record This Question
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