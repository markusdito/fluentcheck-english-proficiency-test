"use client";

import { useRef, useEffect } from "react";
import { Video } from "lucide-react";
import { cn } from "@/lib/utils";

export type WebcamStatus = "standby" | "recording" | "saved";

const STATUS: Record<WebcamStatus, { label: string; tone: string }> = {
  standby: { label: "Camera standby", tone: "bg-sn-field-navy text-sn-navy" },
  recording: { label: "Rec", tone: "bg-sn-field-amber text-sn-ink-amber" },
  saved: { label: "Take saved", tone: "bg-sn-field-green text-sn-ink-green" },
};

interface WebcamPreviewProps {
  stream: MediaStream | null;
  status?: WebcamStatus;
  className?: string;
}

export function WebcamPreview({ stream, status = "standby", className = "" }: WebcamPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const s = STATUS[status];

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div
      className={cn(
        "relative aspect-video overflow-hidden rounded-2xl border border-sn-navy/36 bg-sn-field-navy text-sn-navy",
        !stream && "border-dashed",
        className,
      )}
    >
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 p-4 pt-11 text-center">
          <Video className="size-7" strokeWidth={1.6} aria-hidden="true" />
          <p className="m-0 mt-1 text-[15px] font-semibold text-sn-fg">No camera</p>
        </div>
      )}
      <span
        className={cn(
          "absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.04em]",
          s.tone,
        )}
      >
        {status === "recording" && (
          <span className="size-2 animate-pulse rounded-full bg-current" aria-hidden="true" />
        )}
        {s.label}
      </span>
    </div>
  );
}
