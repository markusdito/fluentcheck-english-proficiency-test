"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseCountdownReturn {
  seconds: number;
  isRunning: boolean;
  isComplete: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  formatted: string;
}

export function useCountdown(
  initialSeconds: number,
  onComplete?: () => void
): UseCountdownReturn {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  const hasCompletedRef = useRef(false);

  onCompleteRef.current = onComplete;

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clearTimer();
    setSeconds(initialSeconds);
    setIsRunning(true);
    setIsComplete(false);
    hasCompletedRef.current = false;
    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearTimer();
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearTimer, initialSeconds]);

  useEffect(() => {
    if (seconds === 0 && !isRunning && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      setIsComplete(true);
      onCompleteRef.current?.();
    }
  }, [seconds, isRunning]);

  const pause = useCallback(() => {
    clearTimer();
    setIsRunning(false);
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setSeconds(initialSeconds);
    setIsRunning(false);
    setIsComplete(false);
    hasCompletedRef.current = false;
  }, [clearTimer, initialSeconds]);

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const formatted = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

  return { seconds, isRunning, isComplete, start, pause, reset, formatted };
}