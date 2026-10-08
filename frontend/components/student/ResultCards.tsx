import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { SubmissionSummary } from "@/lib/dashboard-api";
import { StatusPill } from "./StatusPill";
import { card, focusRing, h3, meta, secondaryButton, statNum } from "./styles";

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

/** Band (RUBRIC_6) or legacy /100 score, or null when not scored. */
export function scoreText(sub: SubmissionSummary) {
  if (sub.score == null) return null;
  return sub.scoringSystem === "RUBRIC_6" ? Number(sub.score).toFixed(2) : `${sub.score}/100`;
}

export function LatestResultCard({ sub }: { sub: SubmissionSummary | undefined }) {
  const score = sub && scoreText(sub);
  return (
    <article className={card}>
      <p className={meta}>Latest result{sub ? ` · ${formatDate(sub.createdAt)}` : ""}</p>
      {sub && score ? (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-4">
            <div className={`${statNum} text-[length:clamp(48px,6vw,72px)]`}>{score}</div>
            <p className="m-0 max-w-[22ch] text-sm text-sn-muted">
              {sub.scoringSystem === "RUBRIC_6" ? "Overall band, scored by two examiners." : "Legacy score."}
            </p>
          </div>
          <div className="mt-5">
            <Link className={secondaryButton} href={`/results/${sub.id}`}>
              View full report
            </Link>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[15px] text-sn-muted">
          No scored assessment yet. Your band appears here once two examiners have scored it.
        </p>
      )}
    </article>
  );
}

export function RecentCard({ subs }: { subs: SubmissionSummary[] }) {
  return (
    <article className={card}>
      <h3 className={h3}>Recent assessments</h3>
      {subs.length ? (
        <div className="mt-3">
          {subs.map((sub) => (
            <div key={sub.id} className="flex items-start justify-between gap-5 border-t border-sn-border py-5">
              <div className="min-w-0">
                <h4 className="mb-1 text-[17px] font-semibold tabular-nums">{formatDate(sub.createdAt)}</h4>
                <p className="m-0 text-sm text-sn-muted">{scoreText(sub) ? `band ${scoreText(sub)}` : "no band"}</p>
              </div>
              <StatusPill status={sub.status} />
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[15px] text-sn-muted">Your assessments will be listed here.</p>
      )}
    </article>
  );
}

const rowClass =
  "grid min-h-18 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-[10px] px-1 py-4 text-left [grid-template-areas:'info_info''band_end'] sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-5 sm:px-3 sm:[grid-template-areas:'info_band_end']";

export function ResultRow({ sub }: { sub: SubmissionSummary }) {
  const score = scoreText(sub);
  const content = (
    <>
      <span className="grid gap-0.5 [grid-area:info]">
        <span className="text-[17px] font-semibold tabular-nums">{formatDate(sub.createdAt)}</span>
        <span className="text-sm text-sn-muted">
          {new Date(sub.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </span>
      <span
        className={`min-w-[3.2ch] text-2xl font-bold tracking-[-0.02em] tabular-nums [grid-area:band] sm:text-right sm:text-[28px] ${score ? "" : "text-sn-muted"}`}
        aria-label={score ? `Score ${score}` : "No score"}
      >
        {score ?? "—"}
      </span>
      <span className="inline-flex items-center gap-3 justify-self-end [grid-area:end]">
        <StatusPill status={sub.status} />
        <ChevronRight
          className={`size-[18px] shrink-0 transition-transform duration-200 group-hover:translate-x-[3px] ${sub.status === "ABANDONED" ? "invisible" : ""}`}
          aria-hidden="true"
        />
      </span>
    </>
  );
  // Abandoned sessions have no report to open.
  if (sub.status === "ABANDONED") return <div className={rowClass}>{content}</div>;
  return (
    <Link href={`/results/${sub.id}`} className={`group ${rowClass} transition-colors duration-200 hover:bg-sn-fg/6 ${focusRing} focus-visible:outline-offset-[-2px]`}>
      {content}
    </Link>
  );
}
