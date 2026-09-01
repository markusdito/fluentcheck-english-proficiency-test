"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type RecordingState = "idle" | "preparing" | "recording" | "finalizing" | "blob-ready" | "error";

interface UseRecordingReturn {
  state: RecordingState;
  blob: Blob | null;
  duration: number;
  error: string | null;
  startRecording: (stream: MediaStream, maxDuration?: number) => void;
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

export function useRecording(): UseRecordingReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  const startRecording = useCallback((stream: MediaStream, maxDuration?: number) => {
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
    setError(null);
    setState("preparing");

    try {
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (recordingGenerationRef.current !== generation) return;
        const recordedBlob = new Blob(chunksRef.current, { type: mimeType });
        mediaRecorderRef.current = null;
        if (recordedBlob.size === 0) {
          setError("Recording produced an empty video. Please try again.");
          setState("error");
        } else {
          setBlob(recordedBlob);
          setState("blob-ready");
        }
        if (durationRef.current) {
          clearInterval(durationRef.current);
          durationRef.current = null;
        }
      };

      recorder.onerror = () => {
        if (recordingGenerationRef.current !== generation) return;
        mediaRecorderRef.current = null;
        setError("Recording failed due to an internal error.");
        setState("error");
        if (durationRef.current) {
          clearInterval(durationRef.current);
          durationRef.current = null;
        }
      };

      recorder.start(1000); // timeslice: 1000ms for duration tracking
      setState("recording");

      // Track duration (counts upward — remaining is derived by the consumer)
      durationRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start recording.");
      setState("error");
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
    setError(null);
    chunksRef.current = [];
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    maxDurationRef.current = undefined;
  }, []);

  return { state, blob, duration, error, startRecording, stopRecording, resetRecording };
}
