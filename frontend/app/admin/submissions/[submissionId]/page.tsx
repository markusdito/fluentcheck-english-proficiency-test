"use client";

import { slotLabel } from "@/lib/assessment-slots";
import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { fetchAdminSubmissionDetail } from "@/lib/admin-api";
import { queryKeys } from "@/lib/query-keys";
import { LazyAnswerMedia } from "@/components/media/LazyAnswerMedia";
import { ScoreCard } from "@/components/results/ScoreCard";
import { RubricBreakdownView } from "@/components/results/RubricBreakdownView";
import { StatusPill } from "@/components/student/StatusPill";
import { BackLink } from "@/components/student/PageShell";
import { card, h2, h3, meta, secondaryButton } from "@/components/student/styles";
import { scoreMaximum } from "@/types/scoring";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("id-ID")}`;
  }
}

export default function AdminSubmissionDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = use(params);
  const submissionQuery = useQuery({
    queryKey: queryKeys.adminSubmission(submissionId),
    queryFn: ({ signal }) =>
      fetchAdminSubmissionDetail(submissionId, signal),
  });
  const submission = submissionQuery.data;

  if (submissionQuery.isPending) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2
          className="size-8 animate-spin text-sn-muted"
          role="status"
          aria-label="Loading submission details"
        />
      </div>
    );
  }

  if (submissionQuery.isError || !submission) {
    const error = submissionQuery.error;
    return (
      <div className={`${card} mx-auto max-w-lg text-center`} role="alert">
        <h1 className={h3}>Unable to open submission</h1>
        <p className="mt-2 text-[15px] text-sn-muted">
          {error instanceof ApiError && error.statusCode === 404
            ? "Submission not found."
            : "Failed to load submission details. Please try again."}
        </p>
        <Link href="/admin/submissions" className={`${secondaryButton} mt-5`}>
          Back to submissions
        </Link>
      </div>
    );
  }

  const hasScoreSurface = !["IN_PROGRESS", "AWAITING_PAYMENT"].includes(
    submission.status
  );
  const scoreMax = scoreMaximum(submission.scoringSystem);

  return (
    <div>
      <BackLink href="/admin/submissions">Back to submissions</BackLink>
      <header className="mt-3 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className={`${h2} truncate`}>{submission.student.name}</h1>
          <p className="mt-2 text-[15px] text-sn-muted">{submission.student.email}</p>
        </div>
        <StatusPill status={submission.status} />
      </header>

      <dl className="mt-8 grid overflow-hidden rounded-2xl border border-sn-border bg-sn-surface sm:grid-cols-3 sm:divide-x sm:divide-sn-border">
        <div className="border-b border-sn-border px-5 py-4 sm:border-b-0">
          <dt className={meta}>Submission ID</dt>
          <dd className="mt-2 break-all text-[15px] tabular-nums">
            {submission.id}
          </dd>
        </div>
        <div className="border-b border-sn-border px-5 py-4 sm:border-b-0">
          <dt className={meta}>Created</dt>
          <dd className="mt-2 text-[15px] tabular-nums">
            {formatDateTime(submission.createdAt)}
          </dd>
        </div>
        <div className="border-b border-sn-border px-5 py-4 sm:border-b-0">
          <dt className={meta}>Test Set</dt>
          <dd className="mt-2 text-[15px]">
            {submission.testSet?.code ?? "Legacy (none)"}
          </dd>
        </div>
        <div className="px-5 py-4">
          <dt className={meta}>Last updated</dt>
          <dd className="mt-2 text-[15px] tabular-nums">
            {formatDateTime(submission.updatedAt)}
          </dd>
        </div>
      </dl>

      {(submission.flags?.length ?? 0) > 0 && (
        <section className="mt-14" aria-labelledby="flags-heading">
          <h2 id="flags-heading" className={h3}>Flags</h2>
          <ul className="mt-4 divide-y divide-sn-border rounded-2xl border border-sn-border bg-sn-surface" role="list">
            {submission.flags!.map((flag) => (
              <li key={flag.id} className="px-5 py-4 text-[15px]">
                <p className="font-semibold">
                  {flag.type.charAt(0) + flag.type.slice(1).replace(/_/g, " ").toLowerCase()}
                  <span className="font-normal text-sn-muted">
                    {" · "}
                    {flag.resolution ? flag.resolution.toLowerCase() : "open"}
                  </span>
                </p>
                <p className="mt-1">{flag.reason}</p>
                <p className="mt-1 text-sm text-sn-muted">
                  Raised {formatDateTime(flag.raisedAt)}
                  {flag.raisedBy && ` by ${flag.raisedBy}`}
                  {flag.timestampSeconds != null && ` · at ${flag.timestampSeconds}s`}
                </p>
                {flag.resolvedAt && (
                  <p className="mt-1 text-sm text-sn-muted">
                    Resolved {formatDateTime(flag.resolvedAt)}
                    {flag.resolvedBy && ` by ${flag.resolvedBy}`}
                    {flag.resolutionNote && `: ${flag.resolutionNote}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {submission.retakeCredit && (
            <p className="mt-3 text-sm text-sn-muted">
              Free retake credit {submission.retakeCredit.redeemedSubmissionId ? "used" : "not used yet"}.
            </p>
          )}
        </section>
      )}

      <section className="mt-14" aria-labelledby="payment-history-heading">
        <h2 id="payment-history-heading" className={h3}>
          Payment history
        </h2>

        {!submission.paymentRequired && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-sn-border bg-sn-surface px-5 py-4 sm:flex-row sm:items-center">
            <StatusPill status="WAIVED" />
            <p className="text-sm leading-6 text-sn-muted">
              {submission.waivedByRetakeCreditFrom
                ? "Free retake: an earlier test by this student was voided."
                : "Payment was not required when this test was completed."}
            </p>
          </div>
        )}

        {submission.payments.length > 0 ? (
          <div className="mt-4 divide-y divide-sn-border rounded-2xl border border-sn-border bg-sn-surface">
            {submission.payments.map((payment) => {
              const reconciliationIdentifiers = [
                ["Merchant reference", payment.merchantReference],
                ["Provider session ID", payment.providerSessionId],
                ["Provider transaction ID", payment.providerTransactionId],
                ["Legacy reference", payment.legacyProviderRef],
              ].filter((identifier): identifier is [string, string] => Boolean(identifier[1]));

              return (
                <div
                  key={payment.id}
                  className="grid items-start gap-4 px-5 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(11rem,auto)]"
                >
                  <StatusPill status={payment.status} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums text-sn-fg">
                      {formatAmount(payment.amount, payment.currency)}
                    </p>
                    <p className="mt-1 text-xs text-sn-muted">
                      {payment.provider ?? "Provider unavailable"}
                    </p>
                    {reconciliationIdentifiers.length > 0 && (
                      <dl className="mt-3 grid gap-x-5 gap-y-2 md:grid-cols-2">
                        {reconciliationIdentifiers.map(([label, value]) => (
                          <div key={label} className="min-w-0">
                            <dt className="text-[10px] uppercase tracking-[0.1em] text-sn-muted">
                              {label}
                            </dt>
                            <dd className="mt-0.5 break-all text-[11px] text-sn-muted">
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-[11px] text-sn-muted">
                      Created {formatDateTime(payment.createdAt)}
                    </p>
                    {payment.paidAt && (
                      <p className="mt-1 text-[11px] text-sn-muted">
                        Paid {formatDateTime(payment.paidAt)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : submission.paymentRequired ? (
          <div className="mt-4 rounded-2xl border border-dashed border-sn-border bg-sn-surface px-6 py-10 text-center text-[15px]">
            <p className="text-sm text-sn-muted">No payment attempts recorded.</p>
          </div>
        ) : null}
      </section>

      <section className="mt-14" aria-labelledby="assignments-heading">
        <h2 id="assignments-heading" className={h3}>
          Examiner assignments
        </h2>

        {submission.assignments.length > 0 ? (
          <div className="mt-4 divide-y divide-sn-border rounded-2xl border border-sn-border bg-sn-surface">
            {submission.assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="grid items-center gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(11rem,auto)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-sn-fg">
                    {assignment.examiner.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-sn-muted">
                    {assignment.examiner.email}
                  </p>
                </div>
                <StatusPill status={assignment.status} />
                <div className="text-left sm:text-right">
                  <p className="text-[11px] text-sn-muted">
                    Assigned {formatDateTime(assignment.createdAt)}
                  </p>
                  <p className="mt-1 text-[11px] text-sn-muted">
                    Updated {formatDateTime(assignment.updatedAt)}
                  </p>
                </div>
                {assignment.score && (
                  <div className="sm:col-span-3">
                    <p className="text-sm font-semibold tabular-nums text-sn-fg">
                      {submission.scoringSystem === "RUBRIC_6" ? "Overall band " : "Score "}
                      {submission.scoringSystem === "RUBRIC_6"
                        ? assignment.score.value.toFixed(1)
                        : assignment.score.value}
                      <span className="font-normal text-sn-muted">/{scoreMax}</span>
                      {assignment.status !== "COMPLETED" && (
                        <span className="font-normal text-sn-muted"> · draft</span>
                      )}
                    </p>
                    {assignment.score.rubric && (
                      <RubricBreakdownView
                        rubric={{ ...assignment.score.rubric, overall: assignment.score.value }}
                        compact
                        className="mt-3"
                      />
                    )}
                    <p className="mt-2 text-sm leading-6 text-sn-muted">
                      {assignment.score.comment || "No comment provided."}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-sn-border bg-sn-surface px-6 py-10 text-center text-[15px]">
            <p className="text-sm text-sn-muted">No examiners assigned.</p>
          </div>
        )}
      </section>

      <section className="mt-14" aria-labelledby="score-summary-heading">
        <h2 id="score-summary-heading" className={h3}>
          Score summary
        </h2>
        {hasScoreSurface ? (
          <ScoreCard
            className="mt-4"
            status={submission.status}
            score={submission.score}
            scoringSystem={submission.scoringSystem}
            rubric={submission.rubric}
            answers={submission.answers}
          />
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-sn-border bg-sn-surface px-6 py-10 text-center text-[15px]">
            <p className="text-sm text-sn-muted">
              Scoring is not available for this submission yet.
            </p>
          </div>
        )}
      </section>

      <section className="mt-14" aria-labelledby="answers-heading">
        <h2 id="answers-heading" className={h3}>
          Answers
        </h2>

        {submission.answers.length > 0 ? (
          <div className="mt-4 space-y-7">
            {submission.answers.map((answer, index) => (
              <article key={answer.id} className="overflow-hidden rounded-2xl border border-sn-border bg-sn-surface">
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-sn-border px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-[13px] uppercase tracking-[0.04em] text-sn-muted">
                      Question {index + 1} · {slotLabel(answer.questionCategory)}
                    </p>
                    {answer.tasks.length > 0 && (
                      <ol className="mt-2 space-y-1">
                        {answer.tasks.map((task) => (
                          <li key={task.id} className="text-sm leading-6 text-sn-muted">
                            {task.order}. {task.promptText}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  {answer.score != null ? (
                    <span className="shrink-0 text-right">
                      <span className="block text-lg font-semibold tabular-nums text-sn-fg">
                        {submission.scoringSystem === "RUBRIC_6"
                          ? answer.score.toFixed(2)
                          : answer.score}
                        <span className="text-xs font-normal text-sn-muted">
                          /{scoreMax}
                        </span>
                      </span>
                      <span className="text-[11px] text-sn-muted">average score</span>
                    </span>
                  ) : (
                    <StatusPill status="AWAITING" />
                  )}
                </header>

                <div className="px-5 py-4">
                  <LazyAnswerMedia
                    audioUrl={answer.audioUrl}
                    videoUrl={answer.videoUrl}
                    durationSeconds={answer.durationSeconds ?? undefined}
                    questionNumber={index + 1}
                    unavailableMessage="Video not available"
                  />

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <StatusPill status={answer.uploadStatus} />
                    {answer.durationSeconds != null && (
                      <p className="text-[11px] text-sn-muted">
                        Duration · {answer.durationSeconds}s
                      </p>
                    )}
                  </div>

                  {answer.rubric && (
                    <div className="mt-6">
                      <p className="mb-2 text-[13px] uppercase tracking-[0.04em] text-sn-muted">Rubric averages</p>
                      <RubricBreakdownView rubric={answer.rubric} compact />
                    </div>
                  )}

                  <div className="mt-6 border-t border-sn-border pt-4">
                    <p className={meta}>Examiner scoring</p>
                    {answer.scores.length > 0 ? (
                      <div className="mt-2 divide-y divide-sn-border">
                        {answer.scores.map((score) => (
                          <div
                            key={score.id}
                            className="py-4"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-sn-fg">
                                  {score.examinerName}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-sn-muted">
                                  {score.comment || "No comment provided."}
                                </p>
                              </div>
                              <p className="shrink-0 text-sm font-semibold tabular-nums text-sn-fg">
                                {submission.scoringSystem === "RUBRIC_6"
                                  ? score.value.toFixed(2)
                                  : score.value}
                                <span className="font-normal text-sn-muted">
                                  /{scoreMax}
                                </span>
                              </p>
                            </div>
                            {score.rubric && (
                              <RubricBreakdownView
                                rubric={score.rubric}
                                compact
                                className="mt-3"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-sn-muted">No examiner scores yet.</p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-sn-border bg-sn-surface px-6 py-10 text-center text-[15px]">
            <p className="text-sm text-sn-muted">No answers recorded.</p>
          </div>
        )}
      </section>
    </div>
  );
}
