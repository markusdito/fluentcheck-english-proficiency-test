"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { fetchAdminSubmissionDetail } from "@/lib/admin-api";
import { queryKeys } from "@/lib/query-keys";
import { LazyAnswerMedia } from "@/components/media/LazyAnswerMedia";
import { ScoreCard } from "@/components/results/ScoreCard";
import { RubricBreakdownView } from "@/components/results/RubricBreakdownView";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubmissionStatus } from "@/components/ui/submission-status";
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
          className="size-8 animate-spin text-ink-faint"
          role="status"
          aria-label="Loading submission details"
        />
      </div>
    );
  }

  if (submissionQuery.isError || !submission) {
    const error = submissionQuery.error;
    return (
      <div className="mx-auto max-w-lg py-16">
        <Alert variant="destructive" className="items-start">
          <CircleAlertIcon />
          <AlertTitle>Unable to open submission</AlertTitle>
          <AlertDescription>
            {error instanceof ApiError && error.statusCode === 404
              ? "Submission not found."
              : "Failed to load submission details. Please try again."}
          </AlertDescription>
        </Alert>
        <Button
          className="mt-4"
          variant="outline"
          render={<Link href="/admin/submissions" />}
        >
          Back to submissions
        </Button>
      </div>
    );
  }

  const hasScoreSurface = !["IN_PROGRESS", "AWAITING_PAYMENT"].includes(
    submission.status
  );
  const scoreMax = scoreMaximum(submission.scoringSystem);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="mark">Submission details</p>
          <h1 className="mt-2 truncate font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            {submission.student.name}
          </h1>
          <p className="mt-1.5 text-sm text-ink-soft">{submission.student.email}</p>
        </div>
        <SubmissionStatus status={submission.status} />
      </header>

      <dl className="mt-8 grid border border-rule bg-paper-raised sm:grid-cols-3 sm:divide-x sm:divide-rule">
        <div className="border-b border-rule px-5 py-4 sm:border-b-0">
          <dt className="mark">Submission ID</dt>
          <dd className="mt-2 break-all font-mono text-xs text-ink">
            {submission.id}
          </dd>
        </div>
        <div className="border-b border-rule px-5 py-4 sm:border-b-0">
          <dt className="mark">Created</dt>
          <dd className="mt-2 font-mono text-xs text-ink">
            {formatDateTime(submission.createdAt)}
          </dd>
        </div>
        <div className="px-5 py-4">
          <dt className="mark">Last updated</dt>
          <dd className="mt-2 font-mono text-xs text-ink">
            {formatDateTime(submission.updatedAt)}
          </dd>
        </div>
      </dl>

      <section className="mt-10" aria-labelledby="payment-history-heading">
        <p className="mark">Billing</p>
        <h2
          id="payment-history-heading"
          className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink"
        >
          Payment history
        </h2>

        {!submission.paymentRequired && (
          <div className="mt-4 flex flex-col gap-3 border border-rule bg-paper-raised px-5 py-4 sm:flex-row sm:items-center">
            <SubmissionStatus status="WAIVED" />
            <p className="text-sm leading-6 text-ink-soft">
              Payment was not required when this test was completed.
            </p>
          </div>
        )}

        {submission.payments.length > 0 ? (
          <div className="mt-4 divide-y divide-rule border border-rule bg-paper-raised">
            {submission.payments.map((payment) => (
              <div
                key={payment.id}
                className="grid items-center gap-4 px-5 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(11rem,auto)]"
              >
                <SubmissionStatus status={payment.status} />
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                    {formatAmount(payment.amount, payment.currency)}
                  </p>
                  <p className="mt-1 truncate text-xs text-ink-soft">
                    {payment.provider ?? "Provider unavailable"}
                    {payment.providerRef ? ` · ${payment.providerRef}` : ""}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="font-mono text-[11px] text-ink-soft">
                    Created {formatDateTime(payment.createdAt)}
                  </p>
                  {payment.paidAt && (
                    <p className="mt-1 font-mono text-[11px] text-ink-faint">
                      Paid {formatDateTime(payment.paidAt)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : submission.paymentRequired ? (
          <div className="mt-4 border border-dashed border-rule-strong bg-paper-raised px-6 py-10 text-center">
            <p className="text-sm text-ink-soft">No payment attempts recorded.</p>
          </div>
        ) : null}
      </section>

      <section className="mt-10" aria-labelledby="assignments-heading">
        <p className="mark">Review team</p>
        <h2
          id="assignments-heading"
          className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink"
        >
          Examiner assignments
        </h2>

        {submission.assignments.length > 0 ? (
          <div className="mt-4 divide-y divide-rule border border-rule bg-paper-raised">
            {submission.assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="grid items-center gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(11rem,auto)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {assignment.examiner.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-ink-soft">
                    {assignment.examiner.email}
                  </p>
                </div>
                <SubmissionStatus status={assignment.status} />
                <div className="text-left sm:text-right">
                  <p className="font-mono text-[11px] text-ink-soft">
                    Assigned {formatDateTime(assignment.createdAt)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-ink-faint">
                    Updated {formatDateTime(assignment.updatedAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 border border-dashed border-rule-strong bg-paper-raised px-6 py-10 text-center">
            <p className="text-sm text-ink-soft">No examiners assigned.</p>
          </div>
        )}
      </section>

      <section className="mt-10" aria-labelledby="score-summary-heading">
        <p className="mark">Result</p>
        <h2
          id="score-summary-heading"
          className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink"
        >
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
          <div className="mt-4 border border-dashed border-rule-strong bg-paper-raised px-6 py-10 text-center">
            <p className="text-sm text-ink-soft">
              Scoring is not available for this submission yet.
            </p>
          </div>
        )}
      </section>

      <section className="mt-10" aria-labelledby="answers-heading">
        <p className="mark">Recorded work</p>
        <h2
          id="answers-heading"
          className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink"
        >
          Answers
        </h2>

        {submission.answers.length > 0 ? (
          <div className="mt-4 space-y-8">
            {submission.answers.map((answer, index) => (
              <article key={answer.id} className="border border-rule bg-paper-raised">
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-rule px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                      Question {index + 1} · {answer.questionCategory.replace(/_/g, " ")}
                    </p>
                    {answer.tasks.length > 0 && (
                      <ol className="mt-2 space-y-1">
                        {answer.tasks.map((task) => (
                          <li key={task.id} className="text-sm leading-6 text-ink-soft">
                            {task.order}. {task.promptText}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  {answer.score != null ? (
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-lg font-semibold tabular-nums text-ink">
                        {submission.scoringSystem === "RUBRIC_6"
                          ? answer.score.toFixed(2)
                          : answer.score}
                        <span className="text-xs font-normal text-ink-faint">
                          /{scoreMax}
                        </span>
                      </span>
                      <span className="text-[11px] text-ink-faint">average score</span>
                    </span>
                  ) : (
                    <SubmissionStatus status="AWAITING" />
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
                    <SubmissionStatus status={answer.uploadStatus} />
                    {answer.durationSeconds != null && (
                      <p className="font-mono text-[11px] text-ink-faint">
                        Duration · {answer.durationSeconds}s
                      </p>
                    )}
                  </div>

                  {answer.rubric && (
                    <div className="mt-6">
                      <p className="mb-2 mark">Rubric averages</p>
                      <RubricBreakdownView rubric={answer.rubric} compact />
                    </div>
                  )}

                  <div className="mt-6 border-t border-rule pt-4">
                    <p className="mark">Examiner scoring</p>
                    {answer.scores.length > 0 ? (
                      <div className="mt-2 divide-y divide-rule">
                        {answer.scores.map((score) => (
                          <div
                            key={score.id}
                            className="py-4"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-ink">
                                  {score.examinerName}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-ink-soft">
                                  {score.comment || "No comment provided."}
                                </p>
                              </div>
                              <p className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink">
                                {submission.scoringSystem === "RUBRIC_6"
                                  ? score.value.toFixed(2)
                                  : score.value}
                                <span className="font-normal text-ink-faint">
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
                      <p className="mt-2 text-sm text-ink-soft">No examiner scores yet.</p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 border border-dashed border-rule-strong bg-paper-raised px-6 py-10 text-center">
            <p className="text-sm text-ink-soft">No answers recorded.</p>
          </div>
        )}
      </section>
    </div>
  );
}
