"use client";

import type { ReactNode } from "react";
import { formatClock } from "@/components/QuestionAudioPlayer";
import { TimerRing } from "./TimerRing";

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
