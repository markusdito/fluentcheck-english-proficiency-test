"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { ghostButton, secondaryButton } from "@/components/student/styles";

export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface QuestionAudioPlayerProps {
  audioUrl: string | null;
  compact?: boolean;
  autoPlay?: boolean;
  /**
   * Test runner only: plays still allowed for this prompt (PRD FR-3.4: 2 per
   * slot, autoplay included). The owner counts plays via `onPlayStarted` so the
   * limit survives a remount. Replaces Play/Pause with one Play/Replay button.
   */
  playsLeft?: number;
  onPlayStarted?: () => void;
  /** Stops the prompt and blocks further plays, e.g. once recording starts. */
  locked?: boolean;
  onEnded?: () => void;
}

/**
 * Audio player for a question's prompt audio.
 *
 * `autoPlay` (used on the test page) replays the prompt whenever the question
 * changes, replaces the browser's full control bar with Play/Pause and Replay,
 * and surfaces a hint if the browser blocks autoplay. Other surfaces retain the
 * native audio controls. Renders a placeholder when the question has no audio
 * yet (not uploaded). With `playsLeft`, a single Play/Replay button plays from
 * the beginning and disables itself when no plays are left.
 */
export function QuestionAudioPlayer({ audioUrl, compact, autoPlay, playsLeft, onPlayStarted, locked, onEnded }: QuestionAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [rawProgress, setRawProgress] = useState({ url: "", time: 0, duration: 0 });
  const limited = playsLeft !== undefined;

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
    if (!autoPlay || !audioUrl || locked || playsLeft === 0) return;
    playAudio(false);
    // Autoplay fires once per prompt; locking later must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, audioUrl, playAudio]);

  useEffect(() => {
    if (locked) audioRef.current?.pause();
  }, [locked]);

  if (!audioUrl) {
    return (
      <p className="text-sm text-sn-muted">
        {compact ? "Audio pending" : "Audio not yet available for this question."}
      </p>
    );
  }

  const autoplayBlocked = blockedUrl === audioUrl;
  const isPlaying = playingUrl === audioUrl;
  // Progress is keyed by URL so a question change starts the bar at zero.
  const progress = rawProgress.url === audioUrl ? rawProgress : { time: 0, duration: 0 };
  const trackProgress = (audio: HTMLAudioElement) =>
    setRawProgress({
      url: audioUrl,
      time: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    });

  return (
    <div className={compact || autoPlay ? "space-y-2" : ""}>
      <audio
        key={audioUrl}
        ref={audioRef}
        src={audioUrl}
        controls={!autoPlay}
        onTimeUpdate={(e) => trackProgress(e.currentTarget)}
        onLoadedMetadata={(e) => trackProgress(e.currentTarget)}
        onPlay={() => {
          setPlayingUrl(audioUrl);
          onPlayStarted?.();
        }}
        onPause={() => setPlayingUrl(null)}
        onEnded={() => {
          setPlayingUrl(null);
          onEnded?.();
        }}
        preload={autoPlay ? "auto" : "metadata"}
        aria-hidden={autoPlay || undefined}
        className={autoPlay ? "hidden" : compact ? "h-9 w-full" : "w-full"}
      >
        <p className="text-sm text-sn-muted">
          Your browser does not support audio playback.
        </p>
      </audio>
      {autoPlay && limited && (
        <LimitedControls
          isPlaying={isPlaying}
          playsLeft={playsLeft}
          disabled={locked || isPlaying || playsLeft <= 0}
          onPlay={() => playAudio(true)}
          progress={progress}
          autoplayBlocked={autoplayBlocked}
        />
      )}
      {autoPlay && !limited && (
        <div>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-5 border-y border-sn-border py-4 max-sm:grid-cols-1">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Question audio controls">
              <button
                type="button"
                className={secondaryButton}
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
                {isPlaying ? <PauseIcon className="size-4" aria-hidden /> : <PlayIcon className="size-4" aria-hidden />}
                {isPlaying ? "Pause" : "Play question"}
              </button>
              <button
                type="button"
                className={ghostButton}
                aria-label="Replay question audio from the beginning"
                onClick={() => playAudio(true)}
              >
                <RotateCcwIcon className="size-4" aria-hidden />
                Replay
              </button>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-sn-fg/6" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-sn-fg"
                style={{ width: `${progress.duration ? Math.min(100, (progress.time / progress.duration) * 100) : 0}%` }}
              />
            </div>
            <span className="text-sm tabular-nums text-sn-muted">
              {formatClock(progress.time)} / {formatClock(progress.duration)}
            </span>
          </div>
          {autoplayBlocked && (
            <p role="status" className="mt-2 text-[13px] text-sn-ink-amber">
              Autoplay blocked — select Play to hear the prompt.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LimitedControls({
  isPlaying,
  playsLeft,
  disabled,
  onPlay,
  progress,
  autoplayBlocked,
}: {
  isPlaying: boolean;
  playsLeft: number;
  disabled: boolean;
  onPlay: () => void;
  progress: { time: number; duration: number };
  autoplayBlocked: boolean;
}) {
  return (
    <div>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-5 border-y border-sn-border py-4 max-sm:grid-cols-1">
        <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Question audio controls">
          <button type="button" className={secondaryButton} onClick={onPlay} disabled={disabled}>
            {playsLeft < 2 ? <RotateCcwIcon className="size-4" aria-hidden /> : <PlayIcon className="size-4" aria-hidden />}
            {isPlaying ? "Playing…" : playsLeft < 2 ? "Replay question" : "Play question"}
          </button>
          <span className="text-sm text-sn-muted">
            {playsLeft} play{playsLeft === 1 ? "" : "s"} left
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-sn-fg/6" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-sn-fg"
            style={{ width: `${progress.duration ? Math.min(100, (progress.time / progress.duration) * 100) : 0}%` }}
          />
        </div>
        <span className="text-sm tabular-nums text-sn-muted">
          {formatClock(progress.time)} / {formatClock(progress.duration)}
        </span>
      </div>
      {autoplayBlocked && (
        <p role="status" className="mt-2 text-[13px] text-sn-ink-amber">
          Autoplay blocked — select Play to hear the prompt.
        </p>
      )}
    </div>
  );
}
