"use client";

import { useState } from "react";
import type { AssignmentAnswer } from "@/types/examiner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CircleAlertIcon } from "lucide-react";

interface ScoringPanelProps {
  answers: AssignmentAnswer[];
  assignmentId: string;
  onSubmit: (scores: Array<{ answerId: string; value: number; comment?: string }>) => Promise<void>;
  isSubmitting: boolean;
}

interface AnswerScore {
  answerId: string;
  value: string;
  comment: string;
}

export function ScoringPanel({ answers, onSubmit, isSubmitting }: ScoringPanelProps) {
  const [scores, setScores] = useState<AnswerScore[]>(() =>
    answers.map((a) => ({ answerId: a.id, value: "", comment: "" }))
  );
  const [error, setError] = useState<string | null>(null);

  const updateScore = (answerId: string, field: "value" | "comment", val: string) => {
    setScores((prev) =>
      prev.map((s) => (s.answerId === answerId ? { ...s, [field]: val } : s))
    );
  };

  const handleSubmit = async () => {
    setError(null);

    const parsed = scores.map((s) => ({
      answerId: s.answerId,
      value: Number(s.value),
      comment: s.comment || undefined,
    }));

    const invalid = parsed.find((s) => isNaN(s.value) || s.value < 0 || s.value > 100);
    if (invalid) {
      setError("All scores must be between 0 and 100.");
      return;
    }

    await onSubmit(parsed);
  };

  return (
    <div className="border border-rule bg-paper-raised p-6">
      <p className="mark">Marking</p>
      <h3 className="mt-1.5 font-display text-xl font-medium tracking-tight text-ink">
        Examiner scores
      </h3>

      <div className="mt-4 space-y-4">
        {answers.map((answer, idx) => {
          const score = scores.find((s) => s.answerId === answer.id);
          if (!score) return null;

          return (
            <div key={answer.id} className="border border-rule bg-rule/20 p-4">
              <p className="text-sm font-medium leading-6 text-ink">
                {idx + 1}.{" "}
                {answer.promptText.length > 60
                  ? answer.promptText.slice(0, 60) + "…"
                  : answer.promptText}
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="w-28">
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
                    onChange={(e) => updateScore(answer.id, "value", e.target.value)}
                    className="h-10"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={`comment-${answer.id}`}
                    className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
                  >
                    Comment (optional)
                  </label>
                  <Input
                    id={`comment-${answer.id}`}
                    type="text"
                    value={score.comment}
                    onChange={(e) => updateScore(answer.id, "comment", e.target.value)}
                    placeholder="Brief feedback…"
                    className="h-10"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4 items-start">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-6 flex justify-end">
        <Button
          variant="default"
          size="lg"
          loading={isSubmitting}
          disabled={isSubmitting}
          onClick={handleSubmit}
        >
          Submit scores
        </Button>
      </div>
    </div>
  );
}
