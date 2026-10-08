"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAssessmentStart } from "@/components/providers/AssessmentStartProvider";
import { Pill } from "@/components/student/StatusPill";
import { h3, primaryButton, secondaryButton } from "@/components/student/styles";
import { cn } from "@/lib/utils";

interface CameraMicPermissionModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type DeviceStatus = "ready" | "error" | "loading" | "idle";

const STATUS_PILL: Record<DeviceStatus, { tone: "green" | "clay" | "navy" | "plain"; label: string }> = {
  ready: { tone: "green", label: "Ready" },
  error: { tone: "clay", label: "Blocked" },
  loading: { tone: "navy", label: "Checking" },
  idle: { tone: "plain", label: "Waiting" },
};

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
  const autoRequestedRef = useRef(false);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Starting the assessment is the consent gesture: request device access
  // automatically instead of waiting for a separate enable click.
  useEffect(() => {
    if (!open) {
      autoRequestedRef.current = false;
      return;
    }
    if (autoRequestedRef.current || mediaReady || isLoading) return;
    autoRequestedRef.current = true;
    void requestPermissions();
  }, [open, mediaReady, isLoading, requestPermissions]);

  const handleClose = () => {
    stopStream();
    onClose();
  };

  if (!open) return null;

  const statusOf = (ready: boolean, error: string | null | undefined): DeviceStatus =>
    ready ? "ready" : error ? "error" : isLoading ? "loading" : "idle";
  const cameraStatus = statusOf(isVideoReady, videoError);
  const micStatus = statusOf(isAudioReady, audioError);
  const hearing = isAudioReady && micLevel > 5;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-sn-fg/24 p-3 font-albert text-sn-fg animate-in fade-in-0 duration-200 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hw-check-title"
        aria-describedby="hw-check-lead"
        className="max-h-[calc(100dvh-24px)] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-2xl border border-sn-border bg-sn-surface px-5 py-6 animate-in fade-in-0 slide-in-from-bottom-3 zoom-in-[0.98] duration-240 ease-spring sm:max-h-[calc(100dvh-40px)] sm:p-7"
      >
        <h3 id="hw-check-title" className={cn(h3, "mb-3")}>
          Before you start
        </h3>
        <p id="hw-check-lead" className="mb-5 text-[15px] text-sn-muted">
          The test runs in one sitting and cannot be paused. Check these three things first.
        </p>

        <div className="overflow-hidden rounded-[10px] bg-sn-fg">
          {stream ? (
            <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" />
          ) : (
            <div className="grid aspect-video place-items-center text-sm text-sn-surface/60">
              {isLoading ? "Waiting for camera…" : "Camera preview appears here"}
            </div>
          )}
        </div>

        <div className="mt-3 mb-5 flex flex-col">
          <CheckRow
            title="Camera"
            note={isVideoReady ? videoDevices[0]?.label || "Camera ready" : videoError || "Waiting for permission"}
            error={cameraStatus === "error"}
            status={<Pill tone={STATUS_PILL[cameraStatus].tone}>{STATUS_PILL[cameraStatus].label}</Pill>}
          />
          <CheckRow
            title="Microphone"
            note={isAudioReady ? audioDevices[0]?.label || "Microphone ready" : audioError || "Waiting for permission"}
            error={micStatus === "error"}
            status={<Pill tone={STATUS_PILL[micStatus].tone}>{STATUS_PILL[micStatus].label}</Pill>}
          >
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-7 items-end gap-[3px]" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <SoundBar key={i} level={micLevel} index={i} />
                ))}
              </div>
              <p className="m-0 text-sm text-sn-muted" aria-live="polite">
                {!isAudioReady
                  ? "Input level shows once the microphone is ready."
                  : hearing
                    ? "Picking up your voice."
                    : "Say a few words to check the input level."}
              </p>
            </div>
          </CheckRow>
          <CheckRow
            title="Quiet room"
            note="Pick a place without background voices, and keep about 10 minutes free."
            status={<Pill tone="navy">Reminder</Pill>}
          />
        </div>

        {(videoError || audioError) && (
          <div role="alert" className="mb-5 rounded-[10px] bg-[color-mix(in_oklch,var(--color-sn-clay)_10%,white)] p-4">
            <p className="m-0 mb-2 text-[15px] font-semibold">Hardware check needs attention</p>
            <ul className="m-0 pl-5 text-[15px] text-sn-clay">
              {videoError && <li>Camera: {videoError}</li>}
              {audioError && <li>Microphone: {audioError}</li>}
            </ul>
            <button
              type="button"
              className={cn(secondaryButton, "mt-3")}
              onClick={() => void requestPermissions()}
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Retry
            </button>
          </div>
        )}

        {monitorError && (
          <p className="mb-5 rounded-[10px] bg-sn-field-amber p-4 text-[15px]">{monitorError}</p>
        )}

        <div className="flex flex-wrap justify-end gap-3 border-t border-sn-border pt-5">
          <button type="button" className={secondaryButton} onClick={handleClose} disabled={isLoading}>
            Not now
          </button>
          <button type="button" className={primaryButton} onClick={onComplete} disabled={!mediaReady || isLoading}>
            {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckRow({
  title,
  note,
  status,
  error,
  children,
}: {
  title: string;
  note: string;
  status: ReactNode;
  error?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-5 border-t border-sn-border py-5 max-sm:grid-cols-1 max-sm:gap-2">
      <div className="min-w-0">
        <h4 className="mb-1 text-[17px] font-semibold">{title}</h4>
        <p className={cn("m-0 truncate text-sm", error ? "text-sn-clay" : "text-sn-muted")}>{note}</p>
        {children}
      </div>
      {status}
    </div>
  );
}

/* Single sound bar; lights up once the mic level passes its threshold. */
function SoundBar({ level, index }: { level: number; index: number }) {
  const active = level >= (index + 1) * 12.5;
  return (
    <div
      className={cn("w-[6px] rounded-full transition-colors duration-75", active ? "bg-sn-ink-green" : "bg-sn-border")}
      style={{ height: `${12 + index * 2}px` }}
    />
  );
}
