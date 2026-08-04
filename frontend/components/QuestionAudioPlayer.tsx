"use client";

import { useEffect, useRef, useState } from "react";

interface QuestionAudioPlayerProps {
  audioUrl: string | null;
  compact?: boolean;
  autoPlay?: boolean;
}

/**
 * Audio player for a question's prompt audio.
 *
 * `autoPlay` (used on the test page) replays the prompt whenever the question
 * changes, and surfaces a hint if the browser blocks autoplay. A "Replay
 * prompt" affordance keeps replay available at any time. Renders a placeholder
 * when the question has no audio yet (not uploaded).
 */
export function QuestionAudioPlayer({ audioUrl, compact, autoPlay }: QuestionAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  // Autoplay the prompt audio whenever the question's audio changes.
  // Blocked state is keyed by URL so a question change naturally resets it.
  useEffect(() => {
    if (!autoPlay || !audioUrl) return;
    const audio = audioRef.current;
    if (!audio) return;
    const attempt = audio.play();
    if (attempt !== undefined) {
      attempt.catch(() => setBlockedUrl(audioUrl));
    }
  }, [autoPlay, audioUrl]);

  if (!audioUrl) {
    return (
      <p className="text-sm text-ink-soft">
        {compact ? "Audio pending" : "Audio not yet available for this question."}
      </p>
    );
  }

  const autoplayBlocked = blockedUrl === audioUrl;

  return (
    <div className={compact ? "space-y-2" : ""}>
      <audio
        key={audioUrl}
        ref={audioRef}
        src={audioUrl}
        controls
        preload={autoPlay ? "auto" : "metadata"}
        className={compact ? "h-9 w-full" : "w-full"}
      >
        <p className="text-sm text-ink-soft">
          Your browser does not support audio playback.
        </p>
      </audio>
      {autoPlay && (
        <div className="flex items-center gap-3">
          {autoplayBlocked && (
            <p className="text-xs text-amber-400">Autoplay blocked — press play above.</p>
          )}
          <button
            type="button"
            onClick={() => {
              setBlockedUrl(null);
              audioRef.current?.play().catch(() => setBlockedUrl(audioUrl));
            }}
            className="text-xs font-semibold text-studio-text/70 underline decoration-studio-text/30 underline-offset-2 transition-colors hover:text-studio-text"
          >
            Replay prompt
          </button>
        </div>
      )}
    </div>
  );
}
