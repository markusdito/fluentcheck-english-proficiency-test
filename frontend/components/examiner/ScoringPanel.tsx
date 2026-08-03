"use client";

import { useState } from "react";
import type { AssignmentAnswer } from "@/types/examiner";
import { Button } from "@/components/ui/button";

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
    <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-[var(--foreground)]">Score Sheet</h3>

      <div className="space-y-4">
        {answers.map((answer, idx) => {
          const score = scores.find((s) => s.answerId === answer.id);
          if (!score) return null;

          return (
            <div key={answer.id} className="rounded-lg border border-[var(--border)] bg-zinc-50 p-4">
              <p className="mb-2 text-sm font-medium text-[var(--foreground)]">
                {idx + 1}. {answer.promptText.length > 60 ? answer.promptText.slice(0, 60) + "..." : answer.promptText}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                    Score (0-100)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={score.value}
                    onChange={(e) => updateScore(answer.id, "value", e.target.value)}
                    className="h-10 w-24 rounded-lg border border-[var(--border)] bg-white px-3 text-sm text-[var(--foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                  />
                </div>
                <div className="flex-[2]">
                  <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                    Comment (optional)
                  </label>
                  <input
                    type="text"
                    value={score.comment}
                    onChange={(e) => updateScore(answer.id, "comment", e.target.value)}
                    placeholder="Brief feedback..."
                    className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      )}

      <div className="mt-6 flex justify-end">
        <Button
          variant="default"
          size="lg"
          loading={isSubmitting}
          disabled={isSubmitting}
          onClick={handleSubmit}
        >
          Submit Scores
        </Button>
      </div>
    </div>
  );
}
