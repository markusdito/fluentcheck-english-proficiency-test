"use client";

import { cn } from "@/lib/utils";

interface RecordingTimerProps {
  elapsed: number;
  maxSeconds: number;
}

export function RecordingTimer({ elapsed, maxSeconds }: RecordingTimerProps) {
  const remaining = Math.max(maxSeconds - elapsed, 0);
  const formatted = `${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, "0")}`;
  const formattedMax = `${Math.floor(maxSeconds / 60)}:${(maxSeconds % 60).toString().padStart(2, "0")}`;
  const progress = Math.min((elapsed / maxSeconds) * 100, 100);
  const isWarning = remaining <= 30;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          "font-mono text-5xl font-semibold tabular-nums",
          isWarning ? "text-signal" : "text-studio-text",
        )}
      >
        {formatted}
        <span className="text-2xl text-studio-text/50"> / {formattedMax}</span>
      </div>
      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-[1px] bg-studio-rule">
        <div
          className={cn(
            "h-full rounded-[1px] transition-all duration-1000 ease-linear",
            isWarning ? "bg-signal" : "bg-studio-text",
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
      {isWarning && remaining > 0 && (
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-signal">
          Time is running out
        </p>
      )}
    </div>
  );
}
