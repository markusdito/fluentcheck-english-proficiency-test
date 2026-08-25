"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QuestionAudioPlayerProps {
  audioUrl: string | null;
  compact?: boolean;
  autoPlay?: boolean;
  onEnded?: () => void;
}

/**
 * Audio player for a question's prompt audio.
 *
 * `autoPlay` (used on the test page) replays the prompt whenever the question
 * changes, replaces the browser's full control bar with Play/Pause and Replay,
 * and surfaces a hint if the browser blocks autoplay. Other surfaces retain the
 * native audio controls. Renders a placeholder when the question has no audio
 * yet (not uploaded).
 */
export function QuestionAudioPlayer({ audioUrl, compact, autoPlay, onEnded }: QuestionAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  const playAudio = useCallback((restart: boolean) => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    if (restart) audio.currentTime = 0;
    setBlockedUrl(null);

    const attempt = audio.play();
    if (attempt !== undefined) {
      attempt.catch(() => {
        setPlayingUrl(null);
        setBlockedUrl(audioUrl);
      });
    }
  }, [audioUrl]);

  // Autoplay the prompt audio whenever the question's audio changes.
  // Blocked state is keyed by URL so a question change naturally resets it.
  useEffect(() => {
    if (!autoPlay || !audioUrl) return;
    playAudio(false);
  }, [autoPlay, audioUrl, playAudio]);

  if (!audioUrl) {
    return (
      <p className="text-sm text-ink-soft">
        {compact ? "Audio pending" : "Audio not yet available for this question."}
      </p>
    );
  }

  const autoplayBlocked = blockedUrl === audioUrl;
  const isPlaying = playingUrl === audioUrl;

  return (
    <div className={compact || autoPlay ? "space-y-2" : ""}>
      <audio
        key={audioUrl}
        ref={audioRef}
        src={audioUrl}
        controls={!autoPlay}
        onPlay={() => setPlayingUrl(audioUrl)}
        onPause={() => setPlayingUrl(null)}
        onEnded={() => {
          setPlayingUrl(null);
          onEnded?.();
        }}
        preload={autoPlay ? "auto" : "metadata"}
        aria-hidden={autoPlay || undefined}
        className={autoPlay ? "hidden" : compact ? "h-9 w-full" : "w-full"}
      >
        <p className="text-sm text-ink-soft">
          Your browser does not support audio playback.
        </p>
      </audio>
      {autoPlay && (
        <div className="space-y-2">
          <div
            className="flex flex-wrap items-center gap-3"
            role="group"
            aria-label="Question audio controls"
          >
            <Button
              type="button"
              variant="invert"
              size="md"
              aria-label={isPlaying ? "Pause question audio" : "Play question audio"}
              onClick={() => {
                if (isPlaying) {
                  setPlayingUrl(null);
                  audioRef.current?.pause();
                } else {
                  playAudio(false);
                }
              }}
            >
              {isPlaying ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
              {isPlaying ? "Pause" : "Play"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              aria-label="Replay question audio from the beginning"
              className="border-studio-rule bg-transparent text-studio-text hover:bg-studio-panel hover:text-studio-text"
              onClick={() => playAudio(true)}
            >
              <RotateCcwIcon aria-hidden />
              Replay
            </Button>
          </div>
          {autoplayBlocked && (
            <p role="status" className="text-xs text-amber-400">
              Autoplay blocked — select Play to hear the prompt.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
