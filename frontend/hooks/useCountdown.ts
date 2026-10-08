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

const TICK_MS = 250;

/**
 * Countdown driven by a monotonic deadline (`performance.now()`), so throttled
 * or delayed interval ticks never stretch the timer (PRD FR-3.6).
 */
export function useCountdown(
  initialSeconds: number,
  onComplete?: () => void
): UseCountdownReturn {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasCompletedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clearTimer();
    const deadline = performance.now() + initialSeconds * 1000;
    setSeconds(initialSeconds);
    setIsRunning(true);
    setIsComplete(false);
    hasCompletedRef.current = false;
    intervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setSeconds(remaining);
      if (remaining === 0) {
        clearTimer();
        setIsRunning(false);
      }
    }, TICK_MS);
  }, [clearTimer, initialSeconds]);

  useEffect(() => {
    if (seconds === 0 && !isRunning && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      setIsComplete(true);
      onComplete?.();
    }
  }, [seconds, isRunning, onComplete]);

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
