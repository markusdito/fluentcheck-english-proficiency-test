"use client";

import { cn } from "@/lib/utils";
import type { AnswerDetail } from "@/lib/dashboard-api";
import {
  scoreMaximum,
  type RubricBreakdown,
  type ScoringSystem,
} from "@/types/scoring";
import { BandGauge } from "@/components/ui/BandGauge";
import { StatusPill } from "@/components/student/StatusPill";
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
      <div className={cn("rounded-2xl border border-sn-border bg-sn-surface p-6 sm:p-8", className)}>
        <p className="text-[15px] font-semibold">Being reviewed</p>
        <p className="mt-1 text-[15px] text-sn-muted">
          The recording is being reviewed by two examiners. Check back soon.
        </p>
      </div>
    );
  }

  const value = score != null ? Number(score) : Number.NaN;
  const hasScore = Number.isFinite(value) && value >= 0;
  const maximum = scoreMaximum(scoringSystem);
  const pendingCount = answers.filter((answer) => answer.score == null).length;

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-sn-border bg-sn-surface", className)}>
      <div className="flex items-center justify-between border-b border-sn-border px-6 py-3">
        <p className="text-[13px] uppercase tracking-[0.04em] text-sn-muted">
          Score report
        </p>
        <StatusPill status={status === "CERTIFIED" ? "CERTIFIED" : "SCORED"} />
      </div>

      <div className="px-6 py-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[13px] uppercase tracking-[0.04em] text-sn-muted">
              Overall {scoringSystem === "RUBRIC_6" ? "band" : "legacy score"}
            </p>
            <p className="mt-1 text-6xl font-light leading-none tracking-[-0.04em] tabular-nums text-sn-fg">
              {hasScore ? displayScore(value, scoringSystem) : "—"}
            </p>
          </div>
          <p className="pb-1 text-[13px] uppercase tracking-[0.04em] text-sn-muted">
            Out of {maximum}
          </p>
        </div>

        {hasScore && (
          <div className="mt-4">
            {scoringSystem === "RUBRIC_6" ? (
              <BandGauge band={value} max={6} size="lg" />
            ) : (
              <div
                className="h-2.5 overflow-hidden rounded-full bg-sn-border"
                role="img"
                aria-label={`Legacy score ${value} of 100`}
              >
                <div
                  className="h-full bg-sn-fg"
                  style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                />
              </div>
            )}
          </div>
        )}

        {scoringSystem === "RUBRIC_6" && rubric && (
          <div className="mt-6">
            <p className="mb-2 text-[13px] uppercase tracking-[0.04em] text-sn-muted">Rubric averages</p>
            <RubricBreakdownView rubric={rubric} compact />
          </div>
        )}

        <dl className="mt-6 divide-y divide-sn-border border-y border-sn-border">
          {answers.map((answer, index) => (
            <div
              key={answer.id}
              className="flex min-h-12 items-center justify-between gap-4 py-2.5"
            >
              <dt className="flex min-w-0 items-center gap-2.5 text-sm text-sn-fg">
                <span className="text-xs text-sn-muted">{index + 1}.</span>
                <span className="truncate">
                  {answer.questionCategory.replace(/_/g, " ")}
                </span>
              </dt>
              <dd className="flex shrink-0 items-center gap-4">
                {answer.score != null ? (
                  <>
                    <span className="hidden w-32 sm:block">
                      <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-sn-border">
                        <span
                          className="h-full bg-sn-fg"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(0, (answer.score / maximum) * 100),
                            )}%`,
                          }}
                        />
                      </span>
                    </span>
                    <span className="w-20 text-right text-sm tabular-nums text-sn-fg">
                      {displayScore(answer.score, scoringSystem)}
                      <span className="text-sn-muted">/{maximum}</span>
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-sn-muted">Not scored</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-5 text-[13px] uppercase tracking-[0.04em] text-sn-muted">
          {pendingCount > 0
            ? `${pendingCount} answer${pendingCount === 1 ? "" : "s"} awaiting review`
            : "Marked by two SpeakNusa examiners"}
        </p>
      </div>
    </div>
  );
}
