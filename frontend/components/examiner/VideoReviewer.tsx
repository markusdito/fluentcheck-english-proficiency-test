"use client";

import { useState, useRef } from "react";
import type { AssignmentAnswer } from "@/types/examiner";

interface VideoReviewerProps {
  answers: AssignmentAnswer[];
}

export function VideoReviewer({ answers }: VideoReviewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const current = answers[currentIndex];

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < answers.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  };

  if (!current) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-[var(--border)] bg-zinc-50 p-12">
        <p className="text-sm text-[var(--muted)]">No answers available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Question info */}
      <div className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {current.questionCategory.replace(/_/g, " ")}
          </span>
          <span className="text-xs text-[var(--muted)]">
            {currentIndex + 1} of {answers.length}
          </span>
        </div>
        <p className="text-sm font-medium text-[var(--foreground)]">{current.promptText}</p>
        {current.tasks.length > 0 && (
          <ul className="mt-2 space-y-1">
            {current.tasks.map((task) => (
              <li key={task.id} className="text-sm text-[var(--muted)]">
                {task.order}. {task.promptText}
              </li>
            ))}
          </ul>
        )}
        {current.durationSeconds != null && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Duration: {Math.floor(current.durationSeconds / 60)}:
            {(current.durationSeconds % 60).toString().padStart(2, "0")}
          </p>
        )}
      </div>

      {/* Video player */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-lg">
        {current.videoUrl ? (
          <video
            ref={videoRef}
            src={current.videoUrl}
            controls
            className="w-full"
            preload="metadata"
          >
            <p className="p-4 text-sm text-zinc-400">
              Your browser does not support video playback.
            </p>
          </video>
        ) : (
          <div className="flex aspect-video items-center justify-center bg-zinc-900">
            <div className="text-center">
              <svg className="mx-auto h-10 w-10 text-zinc-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.91-3.16-3.16a.75.75 0 00-1.06 0L2.5 11.06zm10.5-3.81a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" clipRule="evenodd" />
              </svg>
              <p className="mt-2 text-sm text-zinc-500">Video not yet uploaded</p>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="mr-1.5 h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
          Previous
        </button>
        <span className="text-sm text-[var(--muted)]">
          Question {currentIndex + 1}
        </span>
        <button
          onClick={handleNext}
          disabled={currentIndex >= answers.length - 1}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
          <svg className="ml-1.5 h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
