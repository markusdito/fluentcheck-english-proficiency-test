"use client";

import { useRef } from "react";
import type { AssignmentAnswer } from "@/types/examiner";
import { Badge } from "@/components/ui/badge";
import { QuestionAudioPlayer } from "@/components/QuestionAudioPlayer";

interface VideoReviewerProps {
  answers: AssignmentAnswer[];
  currentIndex: number;
}

export function VideoReviewer({ answers, currentIndex }: VideoReviewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const current = answers[currentIndex];

  if (!current) {
    return (
      <div className="flex items-center justify-center border border-dashed border-rule-strong bg-paper-raised p-12">
        <p className="text-sm text-ink-soft">No answers available.</p>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {/* Question info */}
      <div className="min-w-0 border border-rule bg-paper-raised p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <Badge variant="outline" data-tone="neutral">
            {current.questionCategory.replace(/_/g, " ")}
          </Badge>
          <span className="font-mono text-xs text-ink-faint">
            {currentIndex + 1} of {answers.length}
          </span>
        </div>
        <div className="mb-3 min-w-0">
          <QuestionAudioPlayer audioUrl={current.audioUrl} compact />
        </div>
        {current.tasks.length > 0 && (
          <ul className="mt-2 space-y-1">
            {current.tasks.map((task) => (
              <li key={task.id} className="text-sm text-ink-soft">
                {task.order}. {task.promptText}
              </li>
            ))}
          </ul>
        )}
        {current.durationSeconds != null && (
          <p className="mt-2 font-mono text-[11px] text-ink-faint">
            Duration · {Math.floor(current.durationSeconds / 60)}:
            {(current.durationSeconds % 60).toString().padStart(2, "0")}
          </p>
        )}
      </div>

      {/* Video player */}
      <div className="w-full max-w-full overflow-hidden border border-studio bg-studio">
        {current.videoUrl ? (
          <video
            ref={videoRef}
            src={current.videoUrl}
            controls
            className="block h-auto w-full max-w-full"
            preload="metadata"
          >
            <p className="p-4 text-sm text-studio-text/70">
              Your browser does not support video playback.
            </p>
          </video>
        ) : (
          <div className="flex aspect-video items-center justify-center bg-studio-panel">
            <div className="text-center">
              <svg className="mx-auto h-10 w-10 text-studio-text/40" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.91-3.16-3.16a.75.75 0 00-1.06 0L2.5 11.06zm10.5-3.81a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" clipRule="evenodd" />
              </svg>
              <p className="mt-2 text-sm text-studio-text/50">Video not yet uploaded</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
