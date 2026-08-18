"use client";

import { InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnswerDetail } from "@/lib/dashboard-api";
import {
  scoreMaximum,
  type RubricBreakdown,
  type ScoringSystem,
} from "@/types/scoring";
import { BandGauge } from "@/components/ui/BandGauge";
import { Stamp } from "@/components/ui/Stamp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RubricBreakdownView } from "@/components/results/RubricBreakdownView";

interface ScoreCardProps {
  status?: string;
  score?: string | null;
  scoringSystem: ScoringSystem;
  rubric?: RubricBreakdown | null;
  answers?: AnswerDetail[];
  pending?: boolean;
  className?: string;
}

const PENDING_STATUSES = new Set(["PAID", "SCORING"]);

function displayScore(value: number, scoringSystem: ScoringSystem): string {
  return scoringSystem === "RUBRIC_6" ? value.toFixed(2) : String(value);
}

export function ScoreCard({
  status,
  score,
  scoringSystem,
  rubric,
  answers = [],
  pending,
  className,
}: ScoreCardProps) {
  const isPending = status ? PENDING_STATUSES.has(status) : (pending ?? false);

  if (isPending) {
    return (
      <div className={cn("border border-rule bg-paper-raised p-6 sm:p-8", className)}>
        <Alert className="items-start">
          <InfoIcon />
          <AlertTitle>Being reviewed</AlertTitle>
          <AlertDescription>
            Your recording is being reviewed by our expert jury. Check back soon.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const value = score != null ? Number(score) : Number.NaN;
  const hasScore = Number.isFinite(value) && value >= 0;
  const maximum = scoreMaximum(scoringSystem);
  const pendingCount = answers.filter((answer) => answer.score == null).length;
  const verdict = status === "CERTIFIED" ? "Certified" : "Scored";

  return (
    <div className={cn("border border-rule bg-paper-raised", className)}>
      <div className="flex items-center justify-between border-b border-rule px-6 py-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Specimen report
        </p>
        <Stamp tone="ink">{verdict}</Stamp>
      </div>

      <div className="px-6 py-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              Overall {scoringSystem === "RUBRIC_6" ? "band" : "legacy score"}
            </p>
            <p className="mt-1 font-display text-6xl font-medium leading-none tracking-tight text-ink">
              {hasScore ? displayScore(value, scoringSystem) : "—"}
            </p>
          </div>
          <p className="pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            Out of {maximum}
          </p>
        </div>

        {hasScore && (
          <div className="mt-4">
            {scoringSystem === "RUBRIC_6" ? (
              <BandGauge band={value} max={6} size="lg" />
            ) : (
              <div
                className="h-2.5 overflow-hidden border border-rule bg-rule/40"
                role="img"
                aria-label={`Legacy score ${value} of 100`}
              >
                <div
                  className="h-full bg-ink"
                  style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                />
              </div>
            )}
          </div>
        )}

        {scoringSystem === "RUBRIC_6" && rubric && (
          <div className="mt-6">
            <p className="mb-2 mark">Rubric averages</p>
            <RubricBreakdownView rubric={rubric} compact />
          </div>
        )}

        <dl className="mt-6 divide-y divide-rule border-y border-rule">
          {answers.map((answer, index) => (
            <div
              key={answer.id}
              className="flex min-h-12 items-center justify-between gap-4 py-2.5"
            >
              <dt className="flex min-w-0 items-center gap-2.5 text-sm text-ink">
                <span className="font-mono text-xs text-ink-faint">{index + 1}.</span>
                <span className="truncate">
                  {answer.questionCategory.replace(/_/g, " ")}
                </span>
              </dt>
              <dd className="flex shrink-0 items-center gap-4">
                {answer.score != null ? (
                  <>
                    <span className="hidden w-32 sm:block">
                      <span className="flex h-1.5 w-full overflow-hidden bg-rule">
                        <span
                          className="h-full bg-ink"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(0, (answer.score / maximum) * 100),
                            )}%`,
                          }}
                        />
                      </span>
                    </span>
                    <span className="w-20 text-right font-mono text-sm tabular-nums text-ink">
                      {displayScore(answer.score, scoringSystem)}
                      <span className="text-ink-faint">/{maximum}</span>
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-ink-faint">Not scored</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
          {pendingCount > 0
            ? `${pendingCount} answer${pendingCount === 1 ? "" : "s"} awaiting review`
            : "Marked by the FluentCheck jury"}
        </p>
      </div>
    </div>
  );
}
