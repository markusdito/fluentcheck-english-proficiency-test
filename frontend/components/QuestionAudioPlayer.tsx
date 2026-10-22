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
  /** Fresh signed URL for this prompt; the one it was given may have expired. */
  refreshAudioUrl?: () => Promise<string>;
  /** Called once per prompt when it cannot be played even after refreshing. */
  onFailed?: () => void;
}

/** Fresh URLs fetched per prompt before giving up on it. */
const MAX_AUDIO_REFRESHES = 2;
/** Playback waiting this long for data is treated as a failed load. */
const PROMPT_STALL_TIMEOUT_MS = 10_000;

interface Recovery {
  forUrl: string;
  src: string;
  refreshes: number;
  failed: boolean;
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
 *
 * A prompt that fails to load or play (its signed URL expired, the network
 * dropped) is re-signed through `refreshAudioUrl` and resumes where it stopped
 * without using a play; playback stalled for 10 s counts as a failed load.
 * Once that is exhausted it reports `onFailed` so the slot can go on without it.
 */
export function QuestionAudioPlayer({
  audioUrl,
  compact,
  autoPlay,
  playsLeft,
  onPlayStarted,
  locked,
  onEnded,
  refreshAudioUrl,
  onFailed,
}: QuestionAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [rawProgress, setRawProgress] = useState({ url: "", time: 0, duration: 0 });
  // Recovery is keyed by the prompt URL so a question change starts afresh.
  const [rawRecovery, setRawRecovery] = useState<Recovery | null>(null);
  const limited = playsLeft !== undefined;

  // A play request counts once, however many refreshes it takes to finish.
  const playCountedRef = useRef(false);
  const playWantedRef = useRef(false);
  const resumeAtRef = useRef<number | null>(null);
  const refreshingUrlRef = useRef<string | null>(null);
  const failedUrlRef = useRef<string | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentUrlRef = useRef(audioUrl);
  const lockedRef = useRef(locked);
  useEffect(() => {
    currentUrlRef.current = audioUrl;
    lockedRef.current = locked;
  }, [audioUrl, locked]);

  const playAudio = useCallback((restart: boolean) => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    if (restart) audio.currentTime = 0;
    setBlockedUrl(null);
    playCountedRef.current = false;
    playWantedRef.current = true;

    const attempt = audio.play();
    if (attempt !== undefined) {
      attempt.catch(() => {
        setPlayingUrl(null);
        // A broken source is recovered by `onError`; only a policy refusal is
        // "blocked". Its error event may predate the listener (e.g. before
        // hydration), so replay it; recovery ignores the duplicate.
        if (audio.error) {
          if (audio === audioRef.current) audio.dispatchEvent(new Event("error"));
          return;
        }
        playWantedRef.current = false;
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
    if (!locked) return;
    playWantedRef.current = false;
    clearTimeout(stallTimerRef.current);
    audioRef.current?.pause();
  }, [locked]);

  // A new element (question change or refreshed URL) starts without a stall.
  const elementSrc = rawRecovery?.forUrl === audioUrl ? rawRecovery.src : audioUrl;
  useEffect(() => () => clearTimeout(stallTimerRef.current), [elementSrc]);

  if (!audioUrl) {
    return (
      <p className="text-sm text-sn-muted">
        {compact ? "Audio pending" : "Audio not yet available for this question."}
      </p>
    );
  }

  const recovery: Recovery =
    rawRecovery?.forUrl === audioUrl ? rawRecovery : { forUrl: audioUrl, src: audioUrl, refreshes: 0, failed: false };
  const failed = recovery.failed;
  const autoplayBlocked = blockedUrl === audioUrl && !failed;
  const isPlaying = playingUrl === audioUrl;
  // Progress is keyed by URL so a question change starts the bar at zero.
  const progress = rawProgress.url === audioUrl ? rawProgress : { time: 0, duration: 0 };
  const trackProgress = (audio: HTMLAudioElement) =>
    setRawProgress({
      url: audioUrl,
      time: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    });

  const fail = () => {
    if (failedUrlRef.current === audioUrl) return;
    failedUrlRef.current = audioUrl;
    playWantedRef.current = false;
    setPlayingUrl(null);
    setRawRecovery({ ...recovery, failed: true });
    onFailed?.();
  };

  // Re-sign the prompt and resume from the same position, or give up on it.
  const recover = () => {
    if (locked || failed || refreshingUrlRef.current === audioUrl) return;
    if (!refreshAudioUrl || recovery.refreshes >= MAX_AUDIO_REFRESHES) {
      fail();
      return;
    }
    resumeAtRef.current = audioRef.current?.currentTime ?? 0;
    refreshingUrlRef.current = audioUrl;
    const settle = () => {
      if (refreshingUrlRef.current === audioUrl) refreshingUrlRef.current = null;
      return currentUrlRef.current === audioUrl && !lockedRef.current;
    };
    refreshAudioUrl().then(
      (src) => {
        if (settle()) setRawRecovery({ forUrl: audioUrl, src, refreshes: recovery.refreshes + 1, failed: false });
      },
      () => {
        if (settle()) fail();
      },
    );
  };

  const clearStall = () => clearTimeout(stallTimerRef.current);
  const watchStall = () => {
    clearStall();
    if (!playWantedRef.current || locked) return;
    stallTimerRef.current = setTimeout(recover, PROMPT_STALL_TIMEOUT_MS);
  };

  const resumeAfterRefresh = (audio: HTMLAudioElement) => {
    const resumeAt = resumeAtRef.current;
    if (resumeAt === null || recovery.src === audioUrl) return;
    resumeAtRef.current = null;
    audio.currentTime = resumeAt;
    if (playWantedRef.current && !locked) {
      audio.play()?.catch(() => {
        if (!audio.error) setBlockedUrl(audioUrl);
      });
    }
  };

  return (
    <div className={compact || autoPlay ? "space-y-2" : ""}>
      <audio
        key={recovery.src}
        ref={audioRef}
        src={recovery.src}
        controls={!autoPlay}
        onTimeUpdate={(e) => {
          clearStall();
          trackProgress(e.currentTarget);
        }}
        onWaiting={watchStall}
        onStalled={watchStall}
        onPlaying={clearStall}
        onLoadedMetadata={(e) => {
          trackProgress(e.currentTarget);
          resumeAfterRefresh(e.currentTarget);
        }}
        onPlay={() => {
          setPlayingUrl(audioUrl);
          if (playCountedRef.current) return;
          playCountedRef.current = true;
          onPlayStarted?.();
        }}
        onPause={() => {
          clearStall();
          setPlayingUrl(null);
        }}
        onEnded={() => {
          clearStall();
          playWantedRef.current = false;
          setPlayingUrl(null);
          onEnded?.();
        }}
        onError={recover}
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
          disabled={locked || failed || isPlaying || playsLeft <= 0}
          onPlay={() => playAudio(true)}
          progress={progress}
          autoplayBlocked={autoplayBlocked}
          failed={failed}
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
                disabled={failed}
                onClick={() => {
                  if (isPlaying) {
                    playWantedRef.current = false;
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
                disabled={failed}
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
          {failed && <AudioFailedNotice />}
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
  failed,
}: {
  isPlaying: boolean;
  playsLeft: number;
  disabled: boolean;
  onPlay: () => void;
  progress: { time: number; duration: number };
  autoplayBlocked: boolean;
  failed: boolean;
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
      {failed && <AudioFailedNotice />}
      {autoplayBlocked && (
        <p role="status" className="mt-2 text-[13px] text-sn-ink-amber">
          Autoplay blocked — select Play to hear the prompt.
        </p>
      )}
    </div>
  );
}

function AudioFailedNotice() {
  return (
    <p role="alert" className="mt-2 text-[13px] text-sn-ink-amber">
      The question audio could not be played. Read the question on screen instead.
    </p>
  );
}
