"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Loader2, Mic, Square } from "lucide-react";
import { useAssessmentStart } from "@/components/providers/AssessmentStartProvider";
import { Pill } from "@/components/student/StatusPill";
import { IdentityForm, hasIdentity } from "@/components/student/IdentityForm";
import { h3, primaryButton, secondaryButton } from "@/components/student/styles";
import { useRecording, isRecordingSupported } from "@/hooks/useRecording";
import { detectAudioPresence } from "@/lib/audio-presence";
import { CONSENT_POINTS, readConsent, storeConsent } from "@/lib/consent";
import { cn } from "@/lib/utils";

interface CameraMicPermissionModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type DeviceStatus = "ready" | "error" | "loading" | "idle";
type ClipCheck = "idle" | "checking" | "voice" | "silent" | "undecodable";

const STATUS_PILL: Record<DeviceStatus, { tone: "green" | "clay" | "navy" | "plain"; label: string }> = {
  ready: { tone: "green", label: "Ready" },
  error: { tone: "clay", label: "Blocked" },
  loading: { tone: "navy", label: "Checking" },
  idle: { tone: "plain", label: "Waiting" },
};

/** Long enough to say the identity sentence; the clip never leaves the device. */
const TEST_CLIP_SECONDS = 10;
const WELCOME =
  "Welcome to the SpeakNusa speaking test. Put on your headset, check your microphone, then record a short test clip with your name and Student ID.";

/**
 * PRD §4.1 steps 3–4: informed consent (FR-2.6), then the system check
 * (FR-3.1–3.2): live camera + microphone, welcome audio, identity test clip
 * with playback, level meter and supported-browser check. Start Assessment is
 * enabled only once the clip contains audible speech and the camera is live.
 */
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
    studentId,
    student,
  } = useAssessmentStart();
  const recording = useRecording();

  // Consent is asked on every start, before any capture is requested.
  const [consented, setConsented] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipCheck, setClipCheck] = useState<ClipCheck>("idle");
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setConsented(false);
      setAgreed(false);
    }
  }

  const videoRef = useRef<HTMLVideoElement>(null);
  const autoRequestedRef = useRef(false);
  const welcomedRef = useRef(false);
  const checkedBlobRef = useRef<Blob | null>(null);

  const consentGiven = consented && readConsent(studentId) !== null;
  const supported = open && isRecordingSupported();
  const checking = consentGiven && supported;

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream, checking]);

  // Device access is requested only after consent.
  useEffect(() => {
    if (!checking) {
      autoRequestedRef.current = false;
      return;
    }
    if (autoRequestedRef.current || mediaReady || isLoading) return;
    autoRequestedRef.current = true;
    void requestPermissions();
  }, [checking, mediaReady, isLoading, requestPermissions]);

  // Welcome prompt audio, read by the browser voice when one is available.
  useEffect(() => {
    if (!checking || welcomedRef.current || typeof speechSynthesis === "undefined") return;
    welcomedRef.current = true;
    try {
      speechSynthesis.speak(new SpeechSynthesisUtterance(WELCOME));
    } catch {
      // The welcome text stays on screen.
    }
    return () => {
      try {
        speechSynthesis.cancel();
      } catch {
        // Nothing playing.
      }
    };
  }, [checking]);

  // Validate the finished test clip for audible speech.
  const { blob } = recording;
  useEffect(() => {
    if (!blob || checkedBlobRef.current === blob) return;
    checkedBlobRef.current = blob;
    const url = URL.createObjectURL(blob);
    setClipUrl(url);
    setClipCheck("checking");
    let active = true;
    void detectAudioPresence(blob).then((result) => {
      if (active) setClipCheck(result === null ? "undecodable" : result ? "voice" : "silent");
    });
    return () => {
      active = false;
    };
  }, [blob]);

  useEffect(() => () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
  }, [clipUrl]);

  const resetClip = () => {
    recording.resetRecording();
    checkedBlobRef.current = null;
    setClipUrl(null);
    setClipCheck("idle");
  };

  const handleClose = () => {
    resetClip();
    stopStream();
    onClose();
  };

  if (!open) return null;

  const recordingClip = recording.state === "recording" || recording.state === "preparing";
  const finalizing = recording.state === "finalizing";
  const identityReady = hasIdentity(student);
  const canStart = mediaReady && !isLoading && clipCheck === "voice" && !recordingClip;

  const statusOf = (ready: boolean, error: string | null | undefined): DeviceStatus =>
    ready ? "ready" : error ? "error" : isLoading ? "loading" : "idle";
  const cameraStatus = statusOf(isVideoReady, videoError);
  const micStatus = statusOf(isAudioReady, audioError);
  const hearing = isAudioReady && micLevel > 5;

  const shell = (title: string, lead: string, body: ReactNode, actions: ReactNode) => (
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
        <h3 id="hw-check-title" className={cn(h3, "mb-3")}>{title}</h3>
        <p id="hw-check-lead" className="mb-5 text-[15px] text-sn-muted">{lead}</p>
        {body}
        <div className="flex flex-wrap justify-end gap-3 border-t border-sn-border pt-5">{actions}</div>
      </div>
    </div>
  );

  const notNow = (
    <button type="button" className={secondaryButton} onClick={handleClose} disabled={isLoading}>
      Not now
    </button>
  );

  if (!consentGiven) {
    return shell(
      "Recording consent",
      "Read this before anything is recorded. Your camera and microphone stay off until you agree.",
      <>
        <dl className="m-0 mb-5 flex flex-col">
          {CONSENT_POINTS.map((point) => (
            <div key={point.title} className="border-t border-sn-border py-4">
              <dt className="mb-1 text-[17px] font-semibold">{point.title}</dt>
              <dd className="m-0 text-[15px] text-sn-muted">{point.body}</dd>
            </div>
          ))}
        </dl>
        <label className="mb-5 flex cursor-pointer items-start gap-3 text-[15px]">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 cursor-pointer accent-sn-fg"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>I understand and agree that my answers are recorded as webcam and microphone video for scoring.</span>
        </label>
      </>,
      <>
        {notNow}
        <button
          type="button"
          className={primaryButton}
          disabled={!agreed || !studentId}
          onClick={() => {
            if (!studentId) return;
            storeConsent(studentId);
            setConsented(true);
          }}
        >
          I agree
        </button>
      </>,
    );
  }

  if (!supported) {
    return shell(
      "Browser not supported",
      "This browser cannot record the webcam video the test needs.",
      <p role="alert" className="mb-5 rounded-[10px] bg-[color-mix(in_oklch,var(--color-sn-clay)_10%,white)] p-4 text-[15px]">
        Open SpeakNusa in the latest Chrome, Edge, Firefox or Safari on a computer, over a secure
        (https) connection, then start the test again.
      </p>,
      notNow,
    );
  }

  return shell(
    "System check",
    "The test runs in one sitting and cannot be paused. Check your camera, microphone and voice first.",
    <>
      <p className="mb-4 rounded-[10px] bg-sn-field-navy p-4 text-[15px]">{WELCOME}</p>

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
                  : "Adjust your headset microphone and say a few words."}
            </p>
          </div>
        </CheckRow>
        <CheckRow
          title="Test clip"
          note="Record yourself saying the sentence below, then play it back."
          status={<ClipPill check={clipCheck} recording={recordingClip || finalizing} />}
        >
          {identityReady ? (
            <p className="mt-3 mb-0 rounded-[10px] border border-sn-border p-3 text-[15px]">
              &ldquo;My name is <strong>{student?.fullName}</strong> and my Student ID is{" "}
              <strong>{student?.studentNumber}</strong>.&rdquo;
            </p>
          ) : (
            <div className="mt-3 rounded-[10px] border border-sn-border p-4">
              <p className="m-0 mb-3 text-sm text-sn-muted">
                Add your full name and Student ID first. They are saved to your{" "}
                <Link href="/profile" className="underline">profile</Link>.
              </p>
              {student && <IdentityForm user={student} submitLabel="Save details" />}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {recordingClip ? (
              <button type="button" className={secondaryButton} onClick={recording.stopRecording}>
                <Square className="size-4" aria-hidden="true" />
                Stop ({Math.max(0, TEST_CLIP_SECONDS - recording.duration)}s)
              </button>
            ) : (
              <button
                type="button"
                className={secondaryButton}
                disabled={!mediaReady || !identityReady || finalizing || !stream}
                onClick={() => {
                  if (!stream) return;
                  resetClip();
                  recording.startRecording(stream, TEST_CLIP_SECONDS);
                }}
              >
                <Mic className="size-4" aria-hidden="true" />
                {clipUrl ? "Record again" : "Record Test"}
              </button>
            )}
          </div>
          {clipUrl && !recordingClip && (
            <div className="mt-3">
              <p className="m-0 mb-1 text-sm font-semibold">Playback Audio</p>
              <audio controls src={clipUrl} className="w-full" aria-label="Test clip playback" />
            </div>
          )}
          <p className="mt-2 mb-0 text-sm text-sn-muted" aria-live="polite">
            {clipMessage(clipCheck, recording.error)}
          </p>
        </CheckRow>
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
    </>,
    <>
      {notNow}
      <button
        type="button"
        className={primaryButton}
        onClick={() => {
          resetClip();
          onComplete();
        }}
        disabled={!canStart}
      >
        {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        Start Assessment
      </button>
    </>,
  );
}

function clipMessage(check: ClipCheck, error: string | null): string {
  if (error) return error;
  switch (check) {
    case "checking":
      return "Checking your clip for sound…";
    case "voice":
      return "We heard you clearly. You can start the assessment.";
    case "silent":
      return "We could not hear your voice. Check that your microphone is not muted, move closer and record again.";
    case "undecodable":
      return "This browser could not check the clip. Record again, or switch to the latest Chrome.";
    default:
      return "Start Assessment unlocks once we hear your voice in the clip.";
  }
}

function ClipPill({ check, recording }: { check: ClipCheck; recording: boolean }) {
  if (recording) return <Pill tone="navy">Recording</Pill>;
  if (check === "voice") return <Pill tone="green">Voice heard</Pill>;
  if (check === "silent" || check === "undecodable") return <Pill tone="clay">No voice</Pill>;
  if (check === "checking") return <Pill tone="navy">Checking</Pill>;
  return <Pill tone="plain">Waiting</Pill>;
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
