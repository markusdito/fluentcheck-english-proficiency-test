"use client";

import { slotLabel } from "@/lib/assessment-slots";
import type { AssignmentAnswer } from "@/types/examiner";
import { QuestionAudioPlayer } from "@/components/QuestionAudioPlayer";
import { Pill } from "@/components/student/StatusPill";
import { card, h3, meta } from "@/components/student/styles";

interface VideoReviewerProps {
  answers: AssignmentAnswer[];
  currentIndex: number;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function VideoReviewer({ answers, currentIndex }: VideoReviewerProps) {
  const current = answers[currentIndex];

  if (!current) {
    return (
      <div className={`${card} text-center`}>
        <p className="text-[15px] text-sn-muted">No answers available.</p>
      </div>
    );
  }

  return (
    <article className={card} aria-labelledby="answer-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="answer-title" className={h3}>
          {slotLabel(current.questionCategory)}
        </h2>
        <Pill>
          Answer {currentIndex + 1} of {answers.length}
        </Pill>
      </div>
      <p className="mt-2 text-sm text-sn-muted">
        Prompt snapshot · {current.preparationSeconds} s preparation, {current.recordingSeconds} s recording
        {current.durationSeconds != null && ` · ${clock(current.durationSeconds)} captured`}
      </p>

      <div className="mt-5 grid gap-2">
        <p className={meta}>Question audio</p>
        <QuestionAudioPlayer audioUrl={current.audioUrl} compact />
      </div>

      {current.tasks.length > 0 && (
        <ol className="mt-4 grid list-none gap-1 p-0 text-[15px] text-sn-muted">
          {current.tasks.map((task) => (
            <li key={task.id}>
              {task.order}. {task.promptText}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-5 overflow-hidden rounded-2xl border border-sn-border bg-sn-fg">
        {current.videoUrl ? (
          <video src={current.videoUrl} controls className="block h-auto w-full" preload="metadata">
            <p className="p-4 text-sm text-sn-surface/70">Your browser does not support video playback.</p>
          </video>
        ) : (
          <div className="grid aspect-video place-items-center">
            <p className="text-sm text-sn-surface/60">Recording not yet uploaded</p>
          </div>
        )}
      </div>
    </article>
  );
}
