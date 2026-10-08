"use client";

import { formatClock } from "@/components/QuestionAudioPlayer";
import { cn } from "@/lib/utils";

export const RECORDING_WARNING_SECONDS = 10;

interface SlotTimersProps {
  prepRemaining: number;
  recordingRemaining: number;
  recording: boolean;
  preparing: boolean;
}

function Timer({ label, remaining, active, warn }: { label: string; remaining: number; active: boolean; warn?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-5 py-4",
        active ? "border-sn-fg" : "border-sn-border text-sn-muted",
        warn && "border-sn-ink-amber bg-sn-field-amber text-sn-ink-amber",
      )}
    >
      <p className="m-0 text-[13px] uppercase tracking-[0.04em]">{label}</p>
      <p role="timer" aria-label={`${label} time left`} className="m-0 text-[34px] font-semibold tabular-nums leading-tight">
        {formatClock(remaining)}
      </p>
    </div>
  );
}

/**
 * Preparation and recording countdowns side by side, a recording indicator
 * (text + dot, never colour alone) and the last-10 s warning (PRD FR-3.6).
 */
export function SlotTimers({ prepRemaining, recordingRemaining, recording, preparing }: SlotTimersProps) {
  const warn = recording && recordingRemaining <= RECORDING_WARNING_SECONDS;
  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 gap-3">
        <Timer label="Preparation" remaining={prepRemaining} active={preparing} />
        <Timer label="Recording" remaining={recordingRemaining} active={recording} warn={warn} />
      </div>
      <div className="mt-3 flex min-h-7 flex-wrap items-center gap-3 text-[15px]">
        {recording ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-sn-field-amber px-3 py-1 font-semibold text-sn-ink-amber">
            <span className="size-2.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
            Recording
          </span>
        ) : (
          <span className="text-sn-muted">
            {preparing ? "Recording starts automatically when preparation ends." : "Not recording"}
          </span>
        )}
        {warn && (
          <span className="font-medium text-sn-ink-amber">
            Recording stops in {recordingRemaining} s
          </span>
        )}
      </div>
    </div>
  );
}
