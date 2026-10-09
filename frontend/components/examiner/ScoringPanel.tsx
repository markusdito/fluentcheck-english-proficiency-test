"use client";

import { slotLabel } from "@/lib/assessment-slots";
import { useState, type ReactNode } from "react";
import type { AssignmentAnswer, SavedScore } from "@/types/examiner";
import {
  RUBRIC_CRITERIA,
  type RubricCriterion,
  type RubricValues,
  type ScoreSubmissionInput,
  type ScoringSystem,
} from "@/types/scoring";
import { card, focusRing, h3, primaryButton, secondaryButton } from "@/components/student/styles";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ScoringPanelProps {
  answers: AssignmentAnswer[];
  scoringSystem: ScoringSystem;
  /** The Examiner's saved whole-Submission Score draft, if any. */
  savedScore: SavedScore | null;
  currentIndex: number;
  onQuestionChange: (index: number) => void;
  onSave: (score: ScoreSubmissionInput) => Promise<void>;
  onComplete: () => Promise<void>;
  isSubmitting: boolean;
  /** Media for the current answer, shown above the rubric. */
  children?: ReactNode;
}

type RubricDraft = Record<RubricCriterion, string>;

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

export const partLabel = slotLabel;

const band = (v?: number | null) => (v == null ? "" : v.toFixed(1));

function rubricDraft(rubric?: RubricValues | null): RubricDraft {
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

function BandSelect({ name, value, onChange }: { name: string; value: string; onChange: (value: string) => void }) {
  return (
    <select className={field} aria-label={`${name} band`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select</option>
      {BANDS.map((b) => (
        <option key={b} value={b}>{b}</option>
      ))}
    </select>
  );
}

/**
 * One Score for the whole Submission: the Examiner watches every Answer, then
 * enters the 4 criteria and their own overall band once.
 */
export function ScoringPanel({
  answers,
  scoringSystem,
  savedScore,
  currentIndex,
  onQuestionChange,
  onSave,
  onComplete,
  isSubmitting,
  children,
}: ScoringPanelProps) {
  const rubric6 = scoringSystem === "RUBRIC_6";
  const [rubric, setRubric] = useState<RubricDraft>(() => rubricDraft(savedScore?.rubric));
  // RUBRIC_6: the overall band; LEGACY_100: the 0–100 score.
  const [overall, setOverall] = useState(() =>
    savedScore ? (rubric6 ? band(savedScore.value) : String(savedScore.value)) : "",
  );
  const [comment, setComment] = useState(savedScore?.comment ?? "");
  const [saved, setSaved] = useState(savedScore != null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const touch = () => setSaved(false);

  if (answers.length === 0) {
    return (
      <div className={`${card} text-center`}>
        <p className="text-[15px] text-sn-muted">No answers available for marking.</p>
      </div>
    );
  }

  const buildPayload = (): ScoreSubmissionInput | null => {
    const trimmed = comment.trim() || undefined;
    if (rubric6) {
      const values = rubricValues(rubric);
      if (!values || !overall) {
        setError("Score all four criteria and the overall band.");
        return null;
      }
      return { rubric: values, overall: Number(overall), comment: trimmed };
    }
    const value = Number(overall);
    if (overall.trim().length === 0 || !Number.isFinite(value) || value < 0 || value > 100) {
      setError("Enter a legacy score between 0 and 100.");
      return null;
    }
    return { value, comment: trimmed };
  };

  const save = async (complete: boolean) => {
    setError(null);
    const payload = buildPayload();
    if (!payload) return;
    try {
      await onSave(payload);
      setSaved(true);
      if (complete) await onComplete();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "The score could not be saved. Please try again.",
      );
    }
  };

  return (
    <div className="grid items-start gap-7 min-[921px]:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-7">
        {children}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Answers">
          {answers.map((a, i) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={i === currentIndex}
              onClick={() => onQuestionChange(i)}
              className={`${secondaryButton} aria-pressed:border-sn-fg aria-pressed:bg-sn-fg/6`}
            >
              {partLabel(a.questionCategory)}
            </button>
          ))}
        </div>

        <section className={card} aria-labelledby="rubric-title">
          <h2 id="rubric-title" className={h3}>
            Score the whole submission
          </h2>
          <p className="mt-2 text-sm text-sn-muted">
            Watch all {answers.length} answers, then give one band per criterion and your overall band.
          </p>

          {rubric6 ? (
            <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
              {RUBRIC_CRITERIA.map((criterion) => (
                <label key={criterion} className={label}>
                  <span>
                    <span className="font-medium text-sn-fg">{CRITERION_COPY[criterion].label}</span>
                    <span className="block text-[13px]">{CRITERION_COPY[criterion].description}</span>
                  </span>
                  <BandSelect
                    name={CRITERION_COPY[criterion].label}
                    value={rubric[criterion]}
                    onChange={(value) => {
                      touch();
                      setRubric({ ...rubric, [criterion]: value });
                    }}
                  />
                </label>
              ))}
              <label className={`${label} sm:col-span-2`}>
                <span>
                  <span className="font-medium text-sn-fg">Overall band</span>
                  <span className="block text-[13px]">Your own judgement of the whole submission</span>
                </span>
                <BandSelect
                  name="Overall"
                  value={overall}
                  onChange={(value) => {
                    touch();
                    setOverall(value);
                  }}
                />
              </label>
            </div>
          ) : (
            <label className={`${label} mt-5 max-w-40`}>
              Score (0–100)
              <input
                type="number"
                min={0}
                max={100}
                className={field}
                value={overall}
                onChange={(e) => {
                  touch();
                  setOverall(e.target.value);
                }}
              />
            </label>
          )}

          <label className={`${label} mt-4`}>
            Optional comment
            <textarea
              rows={3}
              className={field}
              value={comment}
              onChange={(e) => {
                touch();
                setComment(e.target.value);
              }}
              placeholder="Feedback on the whole submission…"
            />
          </label>
        </section>
      </div>

      <aside className={`${card} min-[921px]:sticky min-[921px]:top-24`} aria-labelledby="complete-title">
        <h2 id="complete-title" className={h3}>Complete my scoring</h2>
        <p className="mt-2 text-sm text-sn-muted">
          Save a draft anytime. Your score locks once you submit.
        </p>
        <p className="mt-3 text-sm text-sn-muted" role="status">
          {saved ? "Draft saved" : "Unsaved changes"}
        </p>

        {error && (
          <p role="alert" className="mt-3 text-sm text-sn-danger">
            {error}
          </p>
        )}

        <div className="mt-5 grid gap-3">
          <button type="button" className={`${primaryButton} w-full`} disabled={isSubmitting} onClick={() => setConfirming(true)}>
            {isSubmitting ? "Saving…" : "Save & complete"}
          </button>
          <button type="button" className={`${secondaryButton} w-full`} disabled={isSubmitting} onClick={() => void save(false)}>
            Save draft
          </button>
        </div>
        <p className="mt-4 text-[13px] text-sn-muted">
          The student&apos;s band is the mean of your score and the other examiner&apos;s.
        </p>
      </aside>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="max-w-[440px]! gap-0 rounded-2xl bg-sn-surface p-7 font-albert text-sn-fg ring-sn-border">
          <AlertDialogTitle className={h3}>Submit your scoring?</AlertDialogTitle>
          <AlertDialogDescription className="mt-3 text-[15px] text-sn-muted">
            Your score becomes final and can&apos;t be edited. The other examiner scores independently and the report
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
                void save(true);
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
