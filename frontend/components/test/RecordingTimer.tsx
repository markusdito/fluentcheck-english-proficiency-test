"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatClock } from "@/components/QuestionAudioPlayer";

const RING_C = 2 * Math.PI * 55;

interface TimerRingProps {
  remaining: number;
  total: number;
  title: string;
  children?: ReactNode;
}

/** Countdown ring with a side panel; turns amber in the last 10 seconds. */
export function TimerRing({ remaining, total, title, children }: TimerRingProps) {
  const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const warn = remaining <= 10;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-5 sm:gap-8">
      <div className="relative size-[124px] flex-none sm:size-[148px]" aria-hidden="true">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90">
          <circle cx="60" cy="60" r="55" className="fill-none stroke-sn-border stroke-2" />
          <circle
            cx="60"
            cy="60"
            r="55"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - frac)}
            className={cn(
              "fill-none stroke-2 transition-[stroke-dashoffset,stroke] duration-200 ease-linear [stroke-linecap:round]",
              warn ? "stroke-sn-ink-amber" : "stroke-sn-fg",
            )}
          />
        </svg>
        <div
          className={cn(
            "absolute inset-0 grid place-items-center text-[28px] font-semibold tracking-[-0.01em] tabular-nums sm:text-[34px]",
            warn && "text-sn-ink-amber",
          )}
        >
          {formatClock(remaining)}
        </div>
      </div>
      <div className="min-w-60 flex-[1_1_280px]">
        <h3 className="text-[19px] font-semibold leading-[1.3]">{title}</h3>
        {children}
      </div>
    </div>
  );
}

interface RecordingTimerProps {
  elapsed: number;
  maxSeconds: number;
  children?: ReactNode;
}

export function RecordingTimer({ elapsed, maxSeconds, children }: RecordingTimerProps) {
  return (
    <TimerRing remaining={Math.max(maxSeconds - elapsed, 0)} total={maxSeconds} title="Recording">
      <p className="mt-3 mb-0 max-w-[44ch] text-[15px] text-sn-muted">
        Auto-stops at {formatClock(maxSeconds)} · elapsed {formatClock(elapsed)}
      </p>
      {children}
    </TimerRing>
  );
}
