"use client";

import { InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnswerDetail } from "@/lib/dashboard-api";
import { BandGauge } from "@/components/ui/BandGauge";
import { Stamp } from "@/components/ui/Stamp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ScoreCardProps {
  status?: string;
  score?: string | null;
  answers?: AnswerDetail[];
  pending?: boolean;
  className?: string;
}

function scoreTone(score: number) {
  if (score < 50) return "bg-signal";
  if (score < 75) return "bg-amber-500";
  return "bg-verified";
}

const PENDING_STATUSES = new Set(["PAID", "SCORING"]);

/**
 * The single score surface — mirrors the landing page "specimen report":
 * overall band as a `BandGauge` hero, then one ruled row per answer with a
 * 0–100 hairline score bar. `pending` renders the "being reviewed" alert.
 */
export function ScoreCard({
  status,
  score,
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

  const band = score != null ? Number(score) : NaN;
  const hasBand = Number.isFinite(band) && band >= 0;
  const pendingCount = answers.filter((a) => a.score == null).length;
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
              Overall band
            </p>
            <p className="mt-1 font-display text-6xl font-medium leading-none tracking-tight text-ink">
              {hasBand ? score : "—"}
            </p>
          </div>
          <p className="pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            Out of 9
          </p>
        </div>

        {hasBand && (
          <div className="mt-4">
            <BandGauge band={band} size="lg" />
          </div>
        )}

        <dl className="mt-6 divide-y divide-rule">
          {answers.map((answer, index) => (
            <div
              key={answer.id}
              className="flex items-center justify-between gap-4 py-2.5"
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
                      <span className="flex h-1.5 w-full overflow-hidden rounded-[1px] bg-rule">
                        <span
                          className={cn(
                            "h-full rounded-[1px]",
                            scoreTone(answer.score),
                          )}
                          style={{ width: `${answer.score}%` }}
                        />
                      </span>
                    </span>
                    <span className="w-14 text-right font-mono text-sm tabular-nums text-ink">
                      {answer.score}
                      <span className="text-ink-faint">/100</span>
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-ink-faint">Not scored</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-5 border-t border-rule pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
          {pendingCount > 0
            ? `${pendingCount} answer${pendingCount === 1 ? "" : "s"} awaiting review`
            : "Marked by the FluentCheck jury"}
        </p>
      </div>
    </div>
  );
}
