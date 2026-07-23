"use client";

interface RecordingTimerProps {
  seconds: number;
  maxSeconds: number;
}

export function RecordingTimer({ seconds, maxSeconds }: RecordingTimerProps) {
  const formatted = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
  const formattedMax = `${Math.floor(maxSeconds / 60)}:${(maxSeconds % 60).toString().padStart(2, "0")}`;
  const progress = Math.min((seconds / maxSeconds) * 100, 100);
  const isWarning = seconds <= 30 && seconds > 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`text-3xl font-mono font-bold tabular-nums ${isWarning ? "text-red-500" : "text-zinc-900 dark:text-white"}`}>
        {formatted}
        <span className="text-lg text-zinc-400 dark:text-zinc-500"> / {formattedMax}</span>
      </div>
      <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-linear ${
            isWarning ? "bg-red-500" : "bg-blue-600"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}