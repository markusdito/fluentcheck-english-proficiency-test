"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type RecordingState = "idle" | "preparing" | "recording" | "finalizing" | "blob-ready";

interface UseRecordingReturn {
  state: RecordingState;
  blob: Blob | null;
  duration: number;
  /** Why the take ended abnormally; its blob (possibly empty) is still delivered. */
  failure: string | null;
  startRecording: (stream: MediaStream | null, maxDuration?: number) => void;
  stopRecording: () => void;
  resetRecording: () => void;
}

const MIME_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

function getSupportedMimeType(): string {
  for (const mimeType of MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return "video/webm";
}

/**
 * Supported-browser check (PRD FR-3.2): Answers need webcam + mic capture and
 * a MediaRecorder that can produce one of the Answer video formats.
 */
export function isRecordingSupported(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return false;
  try {
    return MIME_TYPES.some((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  } catch {
    return false;
  }
}

export function useRecording(): UseRecordingReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationRef = useRef<number | undefined>(undefined);
  const recordingGenerationRef = useRef(0);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      setState("finalizing");
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Auto-stop when recording reaches max duration
  useEffect(() => {
    if (state === "recording" && maxDurationRef.current && duration >= maxDurationRef.current) {
      stopRecording();
    }
  }, [duration, state, stopRecording]);

  useEffect(() => {
    return () => {
      recordingGenerationRef.current += 1;
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;

      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // The browser may already be tearing down the recorder during unmount.
        }
      }
      if (durationRef.current) {
        clearInterval(durationRef.current);
        durationRef.current = null;
      }
      chunksRef.current = [];
    };
  }, []);

  // Every ended take yields a blob, even a partial or empty one, so it can be
  // uploaded and flagged instead of re-recorded (PRD FR-3.7, FR-3.8).
  const startRecording = useCallback((stream: MediaStream | null, maxDuration?: number) => {
    const previousRecorder = mediaRecorderRef.current;
    recordingGenerationRef.current += 1;
    const generation = recordingGenerationRef.current;
    mediaRecorderRef.current = null;
    if (previousRecorder && previousRecorder.state !== "inactive") {
      try {
        previousRecorder.stop();
      } catch {
        // A recorder that is already stopping cannot be reused.
      }
    }
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    chunksRef.current = [];
    maxDurationRef.current = maxDuration;
    setBlob(null);
    setDuration(0);
    setFailure(null);
    setState("preparing");

    let mimeType = "video/webm";
    const finish = (reason: string | null) => {
      if (recordingGenerationRef.current !== generation) return;
      // A take is delivered once: a later onstop/onerror of this recorder is ignored.
      recordingGenerationRef.current += 1;
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // The failed recorder may already be stopped.
        }
      }
      if (durationRef.current) {
        clearInterval(durationRef.current);
        durationRef.current = null;
      }
      setBlob(new Blob(chunksRef.current, { type: mimeType }));
      setFailure(reason);
      setState("blob-ready");
    };

    try {
      if (!stream) throw new Error("no capture stream");
      mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => finish(null);
      recorder.onerror = () => finish("The recorder stopped unexpectedly");

      recorder.start(1000); // timeslice: 1000ms for duration tracking
      setState("recording");

      // Track duration on a monotonic clock (counts upward — remaining is
      // derived by the consumer) so delayed ticks never stretch speaking time.
      const startedAt = performance.now();
      durationRef.current = setInterval(() => {
        setDuration(Math.floor((performance.now() - startedAt) / 1000));
      }, 250);
    } catch (err) {
      finish(`Recording could not start: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }, []);

  const resetRecording = useCallback(() => {
    recordingGenerationRef.current += 1;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Reset remains safe if the browser has already stopped recording.
      }
    }
    setState("idle");
    setBlob(null);
    setDuration(0);
    setFailure(null);
    chunksRef.current = [];
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    maxDurationRef.current = undefined;
  }, []);

  return { state, blob, duration, failure, startRecording, stopRecording, resetRecording };
}
