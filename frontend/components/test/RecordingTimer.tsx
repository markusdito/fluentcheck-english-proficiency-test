"use client";

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
    <div className="flex flex-col items-center gap-1">
      <div className={`text-3xl font-mono font-bold tabular-nums ${isWarning ? "text-red-500" : "text-white"}`}>
        {formatted}
        <span className="text-lg text-zinc-400"> / {formattedMax}</span>
      </div>
      <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-zinc-700">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-linear ${
            isWarning ? "bg-red-500" : "bg-blue-600"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      {isWarning && remaining > 0 && (
        <p className="text-xs text-red-400">Time is running out!</p>
      )}
    </div>
  );
}