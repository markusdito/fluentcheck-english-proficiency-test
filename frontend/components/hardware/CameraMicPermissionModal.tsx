"use client";

import { useEffect, useRef } from "react";
import { useAssessmentStart } from "@/components/providers/AssessmentStartProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CameraMicPermissionModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function CameraMicPermissionModal({
  open,
  onClose,
  onComplete,
}: CameraMicPermissionModalProps) {
  const {
    stream,
    videoDevices,
    audioDevices,
    videoError,
    audioError,
    monitorError,
    isVideoReady,
    isAudioReady,
    mediaReady,
    isLoading,
    micLevel,
    requestPermissions,
    stopStream,
  } = useAssessmentStart();

  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleClose = () => {
    stopStream();
    onClose();
  };

  const handleComplete = () => {
    onComplete();
  };

  const handleRequest = () => {
    void requestPermissions();
  };

  const allChecksPassed = open && mediaReady;

  const hasActivePermission = open && isAudioReady;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Camera and microphone permissions"
    >
      <div className="w-full max-w-lg border border-rule bg-paper-raised p-6 sm:p-8">
        {/* Header */}
        <div className="mb-6">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Hardware check
          </p>
          <h2 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink">
            Camera & Microphone
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-ink-soft">
            FluentCheck needs access to your webcam and microphone to record your
            speaking responses. Please grant permissions when prompted.
          </p>
        </div>

        {/* Webcam Preview */}
        <div className="mb-5 overflow-hidden bg-studio">
          {stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-48 w-full object-cover"
            />
          ) : (
            <div className="flex h-48 items-center justify-center bg-studio-panel">
              <svg
                className="h-12 w-12 text-studio-text/40"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Status Checks */}
        <div className="mb-6 space-y-3">
          <StatusRow
            label="Webcam"
            status={
              isVideoReady
                ? "success"
                : videoError
                  ? "error"
                  : isLoading
                    ? "loading"
                    : "idle"
            }
            message={
              isVideoReady
                ? videoDevices[0]?.label || "Webcam ready"
                : videoError || "Click Enable camera and microphone"
            }
          />
          <StatusRow
            label="Microphone"
            status={
              isAudioReady
                ? "success"
                : audioError
                  ? "error"
                  : isLoading
                    ? "loading"
                    : "idle"
            }
            message={
              isAudioReady
                ? audioDevices[0]?.label || "Microphone ready"
                : audioError || "Click Enable camera and microphone"
            }
          />

          {/* Mic activity + sound bars */}
          <div className="border border-rule bg-rule/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="shrink-0">
                {hasActivePermission ? (
                  micLevel > 5 ? (
                    <svg className="h-5 w-5 text-verified" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
                      <path d="M5.5 9.643a.75.75 0 00-1.5 0 4.751 4.751 0 109.5 0 .75.75 0 00-1.5 0 3.25 3.25 0 11-6.5 0z" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
                      <path d="M5.5 9.643a.75.75 0 00-1.5 0 4.751 4.751 0 109.5 0 .75.75 0 00-1.5 0 3.25 3.25 0 11-6.5 0z" />
                    </svg>
                  )
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-rule" />
                )}
              </span>

              <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Mic activity</p>
                  <p
                    className={cn(
                      "truncate text-xs",
                      !hasActivePermission
                        ? "text-ink-soft"
                        : micLevel > 5
                          ? "text-verified"
                          : "text-amber-500",
                    )}
                  >
                    {!hasActivePermission
                      ? "Microphone is not ready"
                      : micLevel > 5
                        ? "Microphone is picking up sound"
                        : "Waiting for audio input..."}
                  </p>
                </div>

                <div className="flex shrink-0 items-end gap-[3px]" aria-hidden="true">
                  <SoundBar level={micLevel} index={0} />
                  <SoundBar level={micLevel} index={1} />
                  <SoundBar level={micLevel} index={2} />
                  <SoundBar level={micLevel} index={3} />
                  <SoundBar level={micLevel} index={4} />
                  <SoundBar level={micLevel} index={5} />
                  <SoundBar level={micLevel} index={6} />
                  <SoundBar level={micLevel} index={7} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error / Retry */}
        {(videoError || audioError) && (
          <div className="mb-6 border border-signal/30 bg-signal/5 p-4 text-sm text-signal">
            <p className="font-medium">Hardware check needs attention</p>
            <ul className="mt-1 space-y-1">
              {videoError && <li>Webcam: {videoError}</li>}
              {audioError && <li>Microphone: {audioError}</li>}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 border-signal/40 text-signal hover:bg-signal/10 hover:text-signal"
              onClick={handleRequest}
              loading={isLoading}
            >
              Retry
            </Button>
          </div>
        )}

        {monitorError && (
          <div className="mb-6 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-600">
            {monitorError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
            Skip for now
          </Button>
          {!mediaReady && !videoError && !audioError && (
            <Button
              variant="default"
              onClick={handleRequest}
              disabled={isLoading}
              loading={isLoading}
            >
              Enable camera and microphone
            </Button>
          )}
          <Button
            variant="default"
            onClick={handleComplete}
            disabled={!allChecksPassed || isLoading}
            loading={isLoading}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

/* Single animated sound bar */
interface SoundBarProps {
  level: number; // 0–100
  index: number; // 0–7 bar index
}

function SoundBar({ level, index }: SoundBarProps) {
  const threshold = (index + 1) * 12.5;
  const active = level >= threshold;
  const height = 12 + index * 2;
  const bg = active ? "bg-verified" : "bg-rule-strong";

  return (
    <div
      className={cn(
        "w-[6px] rounded-full transition-all duration-75",
        bg,
        active ? "scale-y-100 opacity-100" : "scale-y-75 opacity-40",
      )}
      style={{ height: `${height}px` }}
    />
  );
}

/* Status indicator row */
interface StatusRowProps {
  label: string;
  status: "success" | "warning" | "error" | "loading" | "idle";
  message: string;
}

function StatusRow({ label, status, message }: StatusRowProps) {
  const iconMap: Record<string, React.ReactNode> = {
    success: (
      <svg className="h-5 w-5 text-verified" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
    ),
    warning: (
      <svg className="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M8.485 3.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 3.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
    ),
    error: (
      <svg className="h-5 w-5 text-signal" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
          clipRule="evenodd"
        />
      </svg>
    ),
    loading: (
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-rule border-t-ink" />
    ),
    idle: (
      <div className="h-5 w-5 rounded-full border-2 border-rule" />
    ),
  };

  return (
    <div className="flex items-center gap-3 border border-rule bg-rule/30 px-4 py-3">
      <span className="shrink-0">{iconMap[status]}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p
          className={cn(
            "truncate text-xs",
            status === "error"
              ? "text-signal"
              : status === "warning"
                ? "text-amber-500"
                : "text-ink-soft",
          )}
        >
          {message}
        </p>
      </div>
    </div>
  );
}
