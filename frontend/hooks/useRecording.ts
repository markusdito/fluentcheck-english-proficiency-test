"use client";

import { useState, useRef, useCallback } from "react";

type RecordingState = "idle" | "preparing" | "recording" | "stopped" | "uploading" | "error";

interface UseRecordingReturn {
  state: RecordingState;
  blob: Blob | null;
  duration: number;
  error: string | null;
  startRecording: (stream: MediaStream) => void;
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

  const startRecording = useCallback((stream: MediaStream) => {
    chunksRef.current = [];
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
        const recordedBlob = new Blob(chunksRef.current, { type: mimeType });
        setBlob(recordedBlob);
        setState("stopped");
        if (durationRef.current) {
          clearInterval(durationRef.current);
          durationRef.current = null;
        }
      };

      recorder.onerror = () => {
        setError("Recording failed due to an internal error.");
        setState("error");
        if (durationRef.current) {
          clearInterval(durationRef.current);
          durationRef.current = null;
        }
      };

      recorder.start(1000); // timeslice: 1000ms for duration tracking
      setState("recording");

      // Track duration
      durationRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start recording.");
      setState("error");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const resetRecording = useCallback(() => {
    setState("idle");
    setBlob(null);
    setDuration(0);
    setError(null);
    chunksRef.current = [];
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
  }, []);

  return { state, blob, duration, error, startRecording, stopRecording, resetRecording };
}