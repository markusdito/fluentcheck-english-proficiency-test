"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeftIcon } from "lucide-react";
import type { AssignmentAnswer } from "@/types/examiner";
import {
  RUBRIC_CRITERIA,
  type RubricCriterion,
  type RubricValues,
  type ScoreSubmissionInput,
  type ScoringSystem,
} from "@/types/scoring";
import { card, focusRing, h3, meta, primaryButton, secondaryButton } from "@/components/student/styles";
import { cn } from "@/lib/cn";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ScoringPanelProps {
  answers: AssignmentAnswer[];
  scoringSystem: ScoringSystem;
  currentIndex: number;
  onQuestionChange: (index: number) => void;
  onSave: (score: ScoreSubmissionInput) => Promise<void>;
  onComplete: () => Promise<void>;
  isSubmitting: boolean;
  /** Media for the current answer, shown above the rubric. */
  children?: ReactNode;
}

type RubricDraft = Record<RubricCriterion, string>;

interface AnswerScore {
  answerId: string;
  value: string;
  rubric: RubricDraft;
  comment: string;
  saved: boolean;
}

const CRITERION_COPY: Record<RubricCriterion, { label: string; description: string }> = {
  pronunciation: { label: "Pronunciation", description: "Sound clarity, stress, and intonation" },
  fluency: { label: "Fluency", description: "Pace, flow, and coherence" },
  vocabulary: { label: "Vocabulary", description: "Range, precision, and appropriacy" },
  grammar: { label: "Grammar", description: "Accuracy, control, and complexity" },
};

// 1.0 … 6.0 in half bands
const BANDS = Array.from({ length: 11 }, (_, i) => (1 + i / 2).toFixed(1));

const field = `min-h-11 w-full rounded-xl border border-sn-border bg-sn-surface px-3 py-2.5 text-[15px] text-sn-fg transition-colors hover:border-sn-fg/32 ${focusRing}`;
const label = "grid gap-1.5 text-sm text-sn-muted";

export const partLabel = (category: string) => category.replace(/_/g, " ");

function rubricDraft(rubric?: RubricValues | null): RubricDraft {
  const band = (v?: number) => (v == null ? "" : v.toFixed(1));
  return {
    pronunciation: band(rubric?.pronunciation),
    fluency: band(rubric?.fluency),
    vocabulary: band(rubric?.vocabulary),
    grammar: band(rubric?.grammar),
  };
}

function rubricValues(draft: RubricDraft): RubricValues | null {
  if (RUBRIC_CRITERIA.some((c) => !draft[c])) return null;
  return Object.fromEntries(RUBRIC_CRITERIA.map((c) => [c, Number(draft[c])])) as unknown as RubricValues;
}

const rubricAverage = (rubric: RubricValues) =>
  RUBRIC_CRITERIA.reduce((total, c) => total + rubric[c], 0) / RUBRIC_CRITERIA.length;

export function ScoringPanel({
  answers,
  scoringSystem,
  currentIndex,
  onQuestionChange,
  onSave,
  onComplete,
  isSubmitting,
  children,
}: ScoringPanelProps) {
  const [scores, setScores] = useState<AnswerScore[]>(() =>
    answers.map((answer) => ({
      answerId: answer.id,
      value: answer.savedScore ? String(answer.savedScore.value) : "",
      rubric: rubricDraft(answer.savedScore?.rubric),
      comment: answer.savedScore?.comment ?? "",
      saved: answer.savedScore != null,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const answer = answers[currentIndex];
  const score = scores[currentIndex];
  const savedCount = scores.filter((item) => item.saved).length;

  const update = (patch: Partial<AnswerScore>) =>
    setScores((current) =>
      current.map((item, index) => (index === currentIndex ? { ...item, ...patch, saved: false } : item)),
    );

  if (!answer || !score) {
    return (
      <div className={`${card} text-center`}>
        <p className="text-[15px] text-sn-muted">No questions available for marking.</p>
      </div>
    );
  }

  const parsedRubric = rubricValues(score.rubric);
  const completedRubrics = scores.flatMap((item) => rubricValues(item.rubric) ?? []);
  const overallPreview =
    completedRubrics.length === answers.length && completedRubrics.length > 0
      ? completedRubrics.reduce((total, rubric) => total + rubricAverage(rubric), 0) / completedRubrics.length
      : null;
  const isLastQuestion = currentIndex === answers.length - 1;

  const handleSave = async () => {
    setError(null);

    let payload: ScoreSubmissionInput;
    if (scoringSystem === "RUBRIC_6") {
      if (!parsedRubric) {
        setError("Score all four criteria before saving this answer.");
        return;
      }
      payload = { answerId: score.answerId, rubric: parsedRubric, comment: score.comment.trim() || undefined };
    } else {
      const value = Number(score.value);
      if (score.value.trim().length === 0 || !Number.isFinite(value) || value < 0 || value > 100) {
        setError("Enter a legacy score between 0 and 100 before saving.");
        return;
      }
      payload = { answerId: score.answerId, value, comment: score.comment.trim() || undefined };
    }

    try {
      await onSave(payload);
      setScores((current) => current.map((item, index) => (index === currentIndex ? { ...item, saved: true } : item)));
      if (isLastQuestion) await onComplete();
      else onQuestionChange(currentIndex + 1);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "This answer could not be saved. Please try again.",
      );
    }
  };

  return (
    <div className="grid items-start gap-7 min-[921px]:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-7">
        {children}
        <section className={card} aria-labelledby="rubric-title">
          <h2 id="rubric-title" className={h3}>
            Score {partLabel(answer.questionCategory)}
          </h2>

          {scoringSystem === "RUBRIC_6" ? (
            <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
              {RUBRIC_CRITERIA.map((criterion) => (
                <label key={criterion} className={label}>
                  <span>
                    <span className="font-medium text-sn-fg">{CRITERION_COPY[criterion].label}</span>
                    <span className="block text-[13px]">{CRITERION_COPY[criterion].description}</span>
                  </span>
                  <select
                    className={field}
                    aria-label={`${CRITERION_COPY[criterion].label} band`}
                    value={score.rubric[criterion]}
                    onChange={(e) => update({ rubric: { ...score.rubric, [criterion]: e.target.value } })}
                  >
                    <option value="">Select</option>
                    {BANDS.map((band) => (
                      <option key={band} value={band}>{band}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : (
            <label className={`${label} mt-5 max-w-40`}>
              Score (0–100)
              <input
                type="number"
                min={0}
                max={100}
                className={field}
                value={score.value}
                onChange={(e) => update({ value: e.target.value })}
              />
            </label>
          )}

          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <label className={`${label} min-w-[220px] flex-1`}>
              Optional comment
              <input
                type="text"
                className={field}
                value={score.comment}
                onChange={(e) => update({ comment: e.target.value })}
                placeholder="Brief feedback…"
              />
            </label>
            {scoringSystem === "RUBRIC_6" && (
              <p className="m-0 pb-2 text-xl font-semibold tabular-nums">
                <span className="text-[15px] font-normal text-sn-muted">Answer mean </span>
                {parsedRubric ? rubricAverage(parsedRubric).toFixed(2) : "·"}
              </p>
            )}
          </div>
        </section>
      </div>

      <aside className={`${card} min-[921px]:sticky min-[921px]:top-24`} aria-labelledby="complete-title">
        <h2 id="complete-title" className={h3}>Complete my scoring</h2>
        <p className="mt-2 text-sm text-sn-muted">
          Save every answer to finish. Scores lock once the last answer is saved.
        </p>
        <ul className="mt-4 grid list-none gap-1 p-0">
          {scores.map((item, index) => (
            <li key={item.answerId}>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setError(null);
                  onQuestionChange(index);
                }}
                aria-current={index === currentIndex ? "step" : undefined}
                className={cn(
                  "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl border-0 bg-transparent px-2 text-left text-[15px] transition-colors hover:bg-sn-fg/6",
                  index === currentIndex ? "font-semibold text-sn-fg" : item.saved ? "text-sn-fg" : "text-sn-muted",
                  focusRing,
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-[18px] shrink-0 place-items-center rounded-md border",
                    item.saved ? "border-sn-ink-green bg-sn-ink-green" : "border-sn-border bg-sn-bg",
                  )}
                >
                  {item.saved && (
                    <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </span>
                {partLabel(answers[index].questionCategory)} {item.saved ? "saved" : "not saved"}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-sn-muted" role="status">
          {savedCount}/{answers.length} saved
          {overallPreview != null && ` · overall preview ${overallPreview.toFixed(2)}`}
        </p>

        {error && (
          <p role="alert" className="mt-3 text-sm text-sn-danger">
            {error}
          </p>
        )}

        <div className="mt-5 grid gap-3">
          <button type="button" className={`${primaryButton} w-full`} disabled={isSubmitting} onClick={() => (isLastQuestion ? setConfirming(true) : void handleSave())}>
            {isSubmitting ? "Saving…" : isLastQuestion ? "Save & complete" : "Save & next answer"}
          </button>
          <button
            type="button"
            className={`${secondaryButton} w-full`}
            disabled={currentIndex === 0 || isSubmitting}
            onClick={() => {
              setError(null);
              onQuestionChange(currentIndex - 1);
            }}
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
            Previous answer
          </button>
        </div>
        <p className="mt-4 text-[13px] text-sn-muted">The final band is the mean of two independent examiners.</p>
      </aside>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="max-w-[440px]! gap-0 rounded-2xl bg-sn-surface p-7 font-albert text-sn-fg ring-sn-border">
          <AlertDialogTitle className={h3}>Submit your scoring?</AlertDialogTitle>
          <AlertDialogDescription className="mt-3 text-[15px] text-sn-muted">
            Your scores become final and can&apos;t be edited. The other examiner scores independently and the report
            shows the mean of both.
          </AlertDialogDescription>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" className={secondaryButton} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={primaryButton}
              onClick={() => {
                setConfirming(false);
                void handleSave();
              }}
            >
              Submit scoring
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
