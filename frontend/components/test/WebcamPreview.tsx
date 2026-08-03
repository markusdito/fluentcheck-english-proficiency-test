"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Stamp } from "@/components/ui/Stamp";

interface WebcamPreviewProps {
  stream: MediaStream | null;
  isRecording?: boolean;
  className?: string;
}

export function WebcamPreview({ stream, isRecording = false, className = "" }: WebcamPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={cn("relative overflow-hidden bg-studio", className)}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-studio-panel">
          <div className="text-center text-studio-text/50">
            <svg className="mx-auto mb-2 h-12 w-12" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <p className="text-sm">No camera</p>
          </div>
        </div>
      )}

      {/* Recording indicator — brand stamp */}
      {isRecording && (
        <div className="absolute left-4 top-4">
          <Stamp tone="signal" dot>
            REC
          </Stamp>
        </div>
      )}
    </div>
  );
}
