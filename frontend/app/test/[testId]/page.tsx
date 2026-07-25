"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useRecording } from "@/hooks/useRecording";
import { useCountdown } from "@/hooks/useCountdown";
import { WebcamPreview } from "@/components/test/WebcamPreview";
import { PromptDisplay } from "@/components/test/PromptDisplay";
import { RecordingTimer } from "@/components/test/RecordingTimer";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { fetchQuestions } from "@/lib/test-api";
import type { Prompt } from "@/types/test";

type TestPhase = "loading" | "preparation" | "recording" | "stopped" | "completed";

export default function TestPage({ params }: { params: Promise<{ testId: string }> }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { testId } = use(params);
  const router = useRouter();

  // Stream management — hardware check already granted permissions
  const { stream, requestPermissions, stopStream } = useMediaDevices();
  const [streamReady, setStreamReady] = useState(false);
  const [initError, setInitError] = useState(false);

  // Recording
  const { duration: recDuration, error: recError, startRecording, stopRecording, resetRecording } = useRecording();

  // Questions state — fetched from backend
  const [questions, setQuestions] = useState<Prompt[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Question phase
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<TestPhase>("loading");
  const [completedQuestions, setCompletedQuestions] = useState<string[]>([]);
  const [showCompletion, setShowCompletion] = useState(false);

  const currentQuestion = questions[currentQuestionIndex];
  const totalQuestions = questions.length;

  // Fetch questions from backend on mount
  useEffect(() => {
    fetchQuestions()
      .then((data) => {
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
      })
      .catch((err: Error) => {
        setFetchError(err.message);
      });
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
  // Covers browser back/forward buttons, direct URL changes, tab close, and reload.
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

  const handleStartRecording = () => {
    if (stream) {
      prepCountdown.pause();
      startRecording(stream);
      recCountdown.start();
      setPhase("recording");
    }
  };

  const handleStopRecording = () => {
    stopRecording();
    recCountdown.pause();
    setPhase("stopped");
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
    // Use hard navigation to guarantee the browser releases all media resources.
    // router.push() is a client-side transition that may not fully tear down
    // the previous page's media stream references (e.g., video element srcObject).
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="w-full max-w-lg text-center">
          <div className="mb-6">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20">
              <svg className="h-10 w-10 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white">Test Complete!</h1>
            <p className="mt-2 text-zinc-400">
              You have answered all {totalQuestions} questions.
            </p>
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
            <Button variant="primary" size="lg" fullWidth onClick={handleFinishTest}>
              Return to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      {/* Top bar — question progress dots */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-2">
          {questions.map((q, i) => (
            <div
              key={q.id}
              className={`h-2 w-8 rounded-full transition-colors ${
                i === currentQuestionIndex
                  ? "bg-blue-500"
                  : completedQuestions.includes(q.id)
                  ? "bg-emerald-500"
                  : "bg-zinc-700"
              }`}
            />
          ))}
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
                </div>
              )}
            </div>

            {/* Error display */}
            {recError && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {recError}
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
                    Start Recording Now
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
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}