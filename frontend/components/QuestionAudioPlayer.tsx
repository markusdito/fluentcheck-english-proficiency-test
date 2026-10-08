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
  /** Test runner only: total plays allowed, autoplay included (PRD FR-3.4). Removes Pause. */
  maxPlays?: number;
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
 * yet (not uploaded). With `maxPlays`, a single Play/Replay button counts
 * every play from the beginning and disables itself when none are left.
 */
export function QuestionAudioPlayer({ audioUrl, compact, autoPlay, maxPlays, locked, onEnded }: QuestionAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [rawProgress, setRawProgress] = useState({ url: "", time: 0, duration: 0 });
  const [plays, setPlays] = useState({ url: "", count: 0 });
  const playCount = plays.url === audioUrl ? plays.count : 0;
  const limited = maxPlays !== undefined;

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
    if (!autoPlay || !audioUrl || locked) return;
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
          if (limited) setPlays((prev) => ({ url: audioUrl, count: (prev.url === audioUrl ? prev.count : 0) + 1 }));
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
          playsLeft={Math.max(0, maxPlays - playCount)}
          played={playCount > 0}
          disabled={locked || isPlaying || playCount >= maxPlays}
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
  played,
  disabled,
  onPlay,
  progress,
  autoplayBlocked,
}: {
  isPlaying: boolean;
  playsLeft: number;
  played: boolean;
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
            {played ? <RotateCcwIcon className="size-4" aria-hidden /> : <PlayIcon className="size-4" aria-hidden />}
            {isPlaying ? "Playing…" : played ? "Replay question" : "Play question"}
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
