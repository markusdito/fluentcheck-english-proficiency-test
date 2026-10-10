"use client";

import { useRef, useState, type FormEvent } from "react";
import { slotLabel } from "@/lib/assessment-slots";
import type { AssignmentAnswer } from "@/types/examiner";
import { QuestionAudioPlayer } from "@/components/QuestionAudioPlayer";
import { CueCardPanel, OptionsPanel } from "@/components/test/PromptDisplay";
import { Pill } from "@/components/student/StatusPill";
import { field } from "@/components/examiner/ScoringPanel";
import { card, h3, meta, primaryButton, secondaryButton } from "@/components/student/styles";

export interface IntegrityConcern {
  answerId: string;
  timestampSeconds?: number;
  note: string;
}

interface VideoReviewerProps {
  answers: AssignmentAnswer[];
  currentIndex: number;
  /** Omit to hide the integrity-concern control (e.g. once scoring is completed). */
  onRaiseConcern?: (concern: IntegrityConcern) => Promise<void>;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const NOTE_MAX = 1000;

function IntegrityConcernForm({
  answerId,
  defaultTimestamp,
  onSubmit,
  onClose,
}: {
  answerId: string;
  defaultTimestamp?: number;
  onSubmit: (concern: IntegrityConcern) => Promise<void>;
  onClose: () => void;
}) {
  const [timestamp, setTimestamp] = useState(defaultTimestamp === undefined ? "" : String(defaultTimestamp));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) return setError("Describe the concern.");
    const seconds = timestamp.trim() === "" ? undefined : Number(timestamp);
    if (seconds !== undefined && (!Number.isSafeInteger(seconds) || seconds < 0)) {
      return setError("Timestamp must be a whole number of seconds.");
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({ answerId, timestampSeconds: seconds, note: trimmed });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The concern could not be raised.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="mt-5 grid gap-3" onSubmit={(event) => void submit(event)} aria-label="Raise integrity concern">
      <label className="grid max-w-48 gap-1.5 text-sm text-sn-muted">
        Timestamp (seconds)
        <input
          type="number"
          min={0}
          step={1}
          className={field}
          value={timestamp}
          onChange={(event) => setTimestamp(event.target.value)}
        />
      </label>
      <label className="grid gap-1.5 text-sm text-sn-muted">
        Note for the Admin
        <textarea
          rows={3}
          required
          maxLength={NOTE_MAX}
          className={field}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-sn-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryButton} disabled={pending}>
          {pending ? "Raising…" : "Raise concern"}
        </button>
        <button type="button" className={secondaryButton} onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function VideoReviewer({ answers, currentIndex, onRaiseConcern }: VideoReviewerProps) {
  const current = answers[currentIndex];
  const videoRef = useRef<HTMLVideoElement>(null);
  // Open form, keyed to the Answer it was opened on; holds the captured video time.
  const [concern, setConcern] = useState<{ answerId: string; at?: number } | null>(null);

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
      {current.technicalFailure && (
        <p className="mt-2 text-sm text-sn-danger">
          Technical failure reported{current.technicalFailureReason ? `: ${current.technicalFailureReason}` : ""}
        </p>
      )}

      <div className="mt-5 grid gap-2">
        <p className={meta}>Question audio</p>
        <QuestionAudioPlayer audioUrl={current.audioUrl} compact />
      </div>

      {current.cueCard && (
        <div className="mt-4">
          <CueCardPanel cueCard={current.cueCard} />
        </div>
      )}
      {current.options && current.options.length > 0 && (
        <div className="mt-4">
          <OptionsPanel options={current.options} />
        </div>
      )}

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
          <video
            key={current.id}
            ref={videoRef}
            src={current.videoUrl}
            controls
            className="block h-auto w-full"
            preload="metadata"
          >
            <p className="p-4 text-sm text-sn-surface/70">Your browser does not support video playback.</p>
          </video>
        ) : (
          <div className="grid aspect-video place-items-center">
            <p className="text-sm text-sn-surface/60">Recording not yet uploaded</p>
          </div>
        )}
      </div>

      {onRaiseConcern &&
        (concern?.answerId === current.id ? (
          <IntegrityConcernForm
            key={current.id}
            answerId={current.id}
            defaultTimestamp={concern.at}
            onSubmit={onRaiseConcern}
            onClose={() => setConcern(null)}
          />
        ) : (
          <button
            type="button"
            className={`${secondaryButton} mt-5`}
            onClick={() =>
              setConcern({
                answerId: current.id,
                // No video: no playback position, so the timestamp starts empty.
                at: current.videoUrl ? Math.floor(videoRef.current?.currentTime ?? 0) : undefined,
              })
            }
          >
            Raise integrity concern
          </button>
        ))}
    </article>
  );
}
