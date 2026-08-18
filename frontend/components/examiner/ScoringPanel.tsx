"use client";

import { useState } from "react";
import { ChevronLeftIcon, CircleAlertIcon } from "lucide-react";
import type { AssignmentAnswer } from "@/types/examiner";
import {
  RUBRIC_CRITERIA,
  type RubricCriterion,
  type RubricValues,
  type ScoreSubmissionInput,
  type ScoringSystem,
} from "@/types/scoring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QuestionAudioPlayer } from "@/components/QuestionAudioPlayer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ScoringPanelProps {
  answers: AssignmentAnswer[];
  scoringSystem: ScoringSystem;
  currentIndex: number;
  onQuestionChange: (index: number) => void;
  onSave: (score: ScoreSubmissionInput) => Promise<void>;
  onComplete: () => Promise<void>;
  isSubmitting: boolean;
}

interface BandSelection {
  whole: string;
  fraction: string;
}

type RubricDraft = Record<RubricCriterion, BandSelection>;

interface AnswerScore {
  answerId: string;
  value: string;
  rubric: RubricDraft;
  comment: string;
  saved: boolean;
}

const CRITERION_COPY: Record<
  RubricCriterion,
  { label: string; description: string }
> = {
  pronunciation: {
    label: "Pronunciation",
    description: "Sound clarity, stress, and intonation",
  },
  fluency: {
    label: "Fluency",
    description: "Pace, flow, and coherence",
  },
  vocabulary: {
    label: "Vocabulary",
    description: "Range, precision, and appropriacy",
  },
  grammar: {
    label: "Grammar",
    description: "Accuracy, control, and complexity",
  },
};

const WHOLE_BANDS = ["1", "2", "3", "4", "5", "6"];

function bandSelection(value?: number): BandSelection {
  if (value == null) return { whole: "", fraction: "" };
  return {
    whole: String(Math.floor(value)),
    fraction: value % 1 === 0.5 ? "5" : "0",
  };
}

function rubricDraft(rubric?: RubricValues | null): RubricDraft {
  return {
    pronunciation: bandSelection(rubric?.pronunciation),
    fluency: bandSelection(rubric?.fluency),
    vocabulary: bandSelection(rubric?.vocabulary),
    grammar: bandSelection(rubric?.grammar),
  };
}

function selectedBand(selection: BandSelection): number | null {
  if (!selection.whole || !selection.fraction) return null;
  return Number(selection.whole) + (selection.fraction === "5" ? 0.5 : 0);
}

function rubricValues(draft: RubricDraft): RubricValues | null {
  const parsed = {} as RubricValues;
  for (const criterion of RUBRIC_CRITERIA) {
    const band = selectedBand(draft[criterion]);
    if (band == null) return null;
    parsed[criterion] = band;
  }
  return parsed;
}

function rubricAverage(rubric: RubricValues): number {
  return (
    RUBRIC_CRITERIA.reduce((total, criterion) => total + rubric[criterion], 0) /
    RUBRIC_CRITERIA.length
  );
}

export function ScoringPanel({
  answers,
  scoringSystem,
  currentIndex,
  onQuestionChange,
  onSave,
  onComplete,
  isSubmitting,
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

  const answer = answers[currentIndex];
  const score = scores[currentIndex];
  const savedCount = scores.filter((item) => item.saved).length;

  const updateComment = (comment: string) => {
    setScores((current) =>
      current.map((item, index) =>
        index === currentIndex ? { ...item, comment, saved: false } : item,
      ),
    );
  };

  const updateLegacyValue = (value: string) => {
    setScores((current) =>
      current.map((item, index) =>
        index === currentIndex ? { ...item, value, saved: false } : item,
      ),
    );
  };

  const updateRubric = (
    criterion: RubricCriterion,
    field: keyof BandSelection,
    value: string,
  ) => {
    setScores((current) =>
      current.map((item, index) => {
        if (index !== currentIndex) return item;
        const selection = item.rubric[criterion];
        const nextSelection = {
          ...selection,
          [field]: value,
          ...(field === "whole" && value === "6" ? { fraction: "0" } : {}),
        };
        return {
          ...item,
          saved: false,
          rubric: { ...item.rubric, [criterion]: nextSelection },
        };
      }),
    );
  };

  if (!answer || !score) {
    return (
      <div className="border border-dashed border-rule-strong bg-paper-raised px-6 py-10 text-center">
        <p className="text-sm text-ink-soft">No questions available for marking.</p>
      </div>
    );
  }

  const parsedRubric = rubricValues(score.rubric);
  const completedRubrics = scores.flatMap((item) => {
    const rubric = rubricValues(item.rubric);
    return rubric ? [rubric] : [];
  });
  const overallPreview =
    completedRubrics.length === answers.length && completedRubrics.length > 0
      ? completedRubrics.reduce(
          (total, rubric) => total + rubricAverage(rubric),
          0,
        ) / completedRubrics.length
      : null;
  const isLastQuestion = currentIndex === answers.length - 1;

  const handleSave = async () => {
    setError(null);

    let payload: ScoreSubmissionInput;
    if (scoringSystem === "RUBRIC_6") {
      if (!parsedRubric) {
        setError("Select all four rubric bands before saving this question.");
        return;
      }
      payload = {
        answerId: score.answerId,
        rubric: parsedRubric,
        comment: score.comment.trim() || undefined,
      };
    } else {
      const value = Number(score.value);
      if (
        score.value.trim().length === 0 ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100
      ) {
        setError("Enter a legacy score between 0 and 100 before saving.");
        return;
      }
      payload = {
        answerId: score.answerId,
        value,
        comment: score.comment.trim() || undefined,
      };
    }

    try {
      await onSave(payload);
      setScores((current) =>
        current.map((item, index) =>
          index === currentIndex ? { ...item, saved: true } : item,
        ),
      );

      if (isLastQuestion) {
        await onComplete();
      } else {
        onQuestionChange(currentIndex + 1);
      }
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "This question could not be saved. Please try again.",
      );
    }
  };

  return (
    <div className="border border-rule bg-paper-raised">
      <div className="border-b border-rule px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mark">Marking</p>
            <h3 className="mt-1.5 font-display text-xl font-medium tracking-tight text-ink">
              Question {currentIndex + 1} of {answers.length}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-soft">
              {scoringSystem === "RUBRIC_6"
                ? "Save this four-part rubric to continue."
                : "Save this legacy score to continue."}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="mark">Progress</p>
            <p className="mt-1 font-mono text-sm tabular-nums text-ink">
              {savedCount}/{answers.length} saved
            </p>
          </div>
        </div>

        <div
          className="mt-4 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${answers.length}, minmax(0, 1fr))` }}
          role="img"
          aria-label={`${savedCount} of ${answers.length} questions saved`}
        >
          {scores.map((item, index) => (
            <span
              key={item.answerId}
              aria-hidden="true"
              className={
                item.saved
                  ? "h-1.5 bg-ink"
                  : index === currentIndex
                    ? "h-1.5 border border-ink bg-paper"
                    : "h-1.5 bg-rule"
              }
            />
          ))}
        </div>
      </div>

      <section className="px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              {answer.questionCategory.replace(/_/g, " ")}
            </p>
            <div className="mt-2">
              <QuestionAudioPlayer audioUrl={answer.audioUrl} compact />
            </div>
          </div>
          <div className="shrink-0 text-right">
            {score.saved && <p className="mark">Saved</p>}
            {parsedRubric && (
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-ink">
                {rubricAverage(parsedRubric).toFixed(2)}
                <span className="font-normal text-ink-faint">/6</span>
              </p>
            )}
          </div>
        </div>

        {scoringSystem === "RUBRIC_6" ? (
          <div className="mt-4 divide-y divide-rule border-y border-rule">
            {RUBRIC_CRITERIA.map((criterion) => {
              const selection = score.rubric[criterion];
              const titleId = `${answer.id}-${criterion}-label`;
              return (
                <div
                  key={criterion}
                  className="grid min-h-20 items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_8.75rem]"
                >
                  <div className="min-w-0">
                    <p id={titleId} className="text-sm font-medium text-ink">
                      {CRITERION_COPY[criterion].label}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-ink-faint">
                      {CRITERION_COPY[criterion].description}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={selection.whole || null}
                      onValueChange={(value) =>
                        value != null && updateRubric(criterion, "whole", value)
                      }
                    >
                      <SelectTrigger
                        className="h-10 w-full rounded-none"
                        aria-label={`${CRITERION_COPY[criterion].label} whole band`}
                      >
                        <SelectValue placeholder="No." />
                      </SelectTrigger>
                      <SelectContent>
                        {WHOLE_BANDS.map((band) => (
                          <SelectItem key={band} value={band}>
                            {band}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={selection.fraction || null}
                      onValueChange={(value) =>
                        value != null && updateRubric(criterion, "fraction", value)
                      }
                    >
                      <SelectTrigger
                        className="h-10 w-full rounded-none"
                        aria-label={`${CRITERION_COPY[criterion].label} decimal band`}
                      >
                        <SelectValue placeholder="Dec." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">.0</SelectItem>
                        <SelectItem value="5" disabled={selection.whole === "6"}>
                          .5
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 w-36">
            <label
              htmlFor={`score-${answer.id}`}
              className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
            >
              Score (0–100)
            </label>
            <Input
              id={`score-${answer.id}`}
              type="number"
              min={0}
              max={100}
              value={score.value}
              onChange={(event) => updateLegacyValue(event.target.value)}
              className="h-10 rounded-none"
            />
          </div>
        )}

        <div className="mt-4">
          <label
            htmlFor={`comment-${answer.id}`}
            className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
          >
            Question comment (optional)
          </label>
          <Input
            id={`comment-${answer.id}`}
            type="text"
            value={score.comment}
            onChange={(event) => updateComment(event.target.value)}
            placeholder="Brief feedback…"
            className="h-10 rounded-none"
          />
        </div>

        {overallPreview != null && isLastQuestion && (
          <div className="mt-4 flex items-center justify-between border-t border-rule pt-4">
            <p className="mark">Overall preview</p>
            <p className="font-mono text-lg font-semibold tabular-nums text-ink">
              {overallPreview.toFixed(2)}
              <span className="text-xs font-normal text-ink-faint">/6</span>
            </p>
          </div>
        )}
      </section>

      {error && (
        <div className="px-5 pb-5">
          <Alert variant="destructive" className="items-start">
            <CircleAlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-rule px-5 py-5">
        <Button
          variant="outline"
          size="lg"
          disabled={currentIndex === 0 || isSubmitting}
          onClick={() => {
            setError(null);
            onQuestionChange(currentIndex - 1);
          }}
        >
          <ChevronLeftIcon data-icon="inline-start" />
          Previous
        </Button>
        <Button
          variant="default"
          size="lg"
          loading={isSubmitting}
          disabled={isSubmitting}
          onClick={handleSave}
        >
          {isLastQuestion ? "Save & complete" : "Save & next question"}
        </Button>
      </div>
    </div>
  );
}
