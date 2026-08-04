"use client";

import { useRef, useState, useCallback } from "react";

interface VideoPlayerProps {
  src: string;
  durationSeconds?: number;
}

/**
 * Video player with a custom seek bar that uses `durationSeconds` from the
 * API to show the full seek range immediately — even before the browser knows
 * the WebM duration (WebM stores metadata at the end of the file).
 *
 * The browser streams incrementally, but the custom progress bar always shows
 * the full duration. Clicking anywhere seeks instantly (buffering from there).
 */
export default function VideoPlayer({ src, durationSeconds }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const maxSeconds = durationSeconds ?? 0;

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);

    // Track buffered range (first range end)
    if (v.buffered.length > 0) {
      setBuffered(v.buffered.end(v.buffered.length - 1));
    }
  }, []);

  const handleSeek = useCallback((clientX: number) => {
    const bar = barRef.current;
    const video = videoRef.current;
    if (!bar || !video) return;

    const rect = bar.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = fraction * maxSeconds;
    video.currentTime = targetTime;
    setCurrentTime(targetTime);
    setSeeking(true);
    setTimeout(() => setSeeking(false), 200);
  }, [maxSeconds]);

  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    handleSeek(e.clientX);
  }, [handleSeek]);

  const handleBarDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return; // left button only
    handleSeek(e.clientX);
  }, [handleSeek]);

  const progressPct = maxSeconds > 0 ? (currentTime / maxSeconds) * 100 : 0;
  const bufferedPct = maxSeconds > 0 ? (buffered / maxSeconds) * 100 : 0;

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div className="relative w-full max-h-96 rounded-lg bg-black overflow-hidden group">
      {/* Video element — streams directly from R2 */}
      <video
        ref={videoRef}
        controls
        className="w-full max-h-96 rounded-lg bg-black"
        preload="auto"
        playsInline
        src={src}
        onLoadedData={() => setLoading(false)}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={handleTimeUpdate}
        onProgress={handleTimeUpdate}
        onSeeked={() => setSeeking(false)}
      >
        Your browser does not support the video tag.
      </video>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" role="status" aria-label="Loading video" />
            <span className="text-xs text-white/50">Loading video…</span>
          </div>
        </div>
      )}

      {/* Custom controls overlay */}
      <div className="absolute inset-0 flex flex-col justify-end pointer-events-none">
        {/* Center play button — only visible when paused */}
        {!loading && paused && (
          <button
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto hover:bg-black/70"
            onClick={() => videoRef.current?.play()}
            aria-label="Play"
          >
            <svg className="w-8 h-8 text-white ml-1" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        )}

        {/* Seek bar at bottom */}
        <div
          className="pointer-events-auto h-10 bg-gradient-to-t from-black/80 to-transparent px-3 pt-4 pb-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <div
            ref={barRef}
            className="relative w-full h-1.5 bg-white/20 rounded-[1px] cursor-pointer hover:h-2 transition-all"
            onClick={handleBarClick}
            onMouseMove={handleBarDrag}
          >
            {/* Buffered */}
            <div
              className="absolute inset-y-0 left-0 bg-white/20 rounded-[1px] pointer-events-none"
              style={{ width: `${bufferedPct}%` }}
            />
            {/* Played progress */}
            <div
              className="absolute inset-y-0 left-0 bg-signal rounded-[1px] pointer-events-none"
              style={{ width: `${progressPct}%` }}
            />
            {/* Thumb */}
            <div
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-signal rounded-full shadow pointer-events-none transition-transform ${seeking ? 'scale-125' : 'scale-0 group-hover:scale-100'}`}
              style={{ left: `${progressPct}%` }}
            />
          </div>
          {/* Time labels */}
          <div className="flex justify-between mt-1 text-[10px] text-white/60">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(maxSeconds)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}