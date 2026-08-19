"use client";

import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  InfoIcon,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchSubmissionDetail,
  paySubmission,
  type SubmissionDetail,
  type SubmissionStatusSnapshot,
} from "@/lib/dashboard-api";
import { useSession } from "@/hooks/useSession";
import { useSubmissionStatusPolling } from "@/hooks/useSubmissionStatusPolling";
import { queryKeys } from "@/lib/query-keys";
import { LazyAnswerMedia } from "@/components/media/LazyAnswerMedia";
import { Header } from "@/components/layout/Header";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import { SubmissionStatus } from "@/components/ui/submission-status";
import { ScoreCard } from "@/components/results/ScoreCard";
import { RubricBreakdownView } from "@/components/results/RubricBreakdownView";
import { scoreMaximum } from "@/types/scoring";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function SubmissionResultPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = use(params);
  const searchParams = useSearchParams();
  const paymentResult = searchParams.get("payment");
  const queryClient = useQueryClient();
  const session = useSession({ required: true });
  const user = session.data;
  const submissionQuery = useQuery({
    queryKey: queryKeys.submissionDetail(submissionId),
    queryFn: ({ signal }) => fetchSubmissionDetail(submissionId, signal),
    enabled: Boolean(user),
  });
  const submission = submissionQuery.data;
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const paymentConfirmedToastShown = useRef(false);

  // One-time toasts for post-redirect payment outcomes
  useEffect(() => {
    if (paymentResult === "success") {
      toast.success("Payment submitted", {
        description: "We're waiting for iPaymu to confirm your payment.",
      });
    } else if (paymentResult === "cancelled") {
      toast("Payment cancelled", {
        description: "You can try again when you are ready.",
      });
    }
  }, [paymentResult]);

  const handlePay = async () => {
    setPaying(true);
    setPayError("");
    try {
      const checkout = await paySubmission(submissionId);
      window.location.assign(checkout.paymentUrl);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  const handlePaymentStatusChange = useCallback(
    (snapshot: SubmissionStatusSnapshot) => {
      queryClient.setQueryData<SubmissionDetail>(
        queryKeys.submissionDetail(submissionId),
        (current) =>
          current ? { ...current, status: snapshot.status } : current,
      );
      if (!paymentConfirmedToastShown.current) {
        paymentConfirmedToastShown.current = true;
        toast.success("Payment confirmed", {
          description: "Your assessment is now being reviewed.",
        });
      }
    },
    [queryClient, submissionId],
  );

  useSubmissionStatusPolling({
    submissionId,
    enabled:
      paymentResult === "success" &&
      submission?.status === "AWAITING_PAYMENT",
    onStatusChange: handlePaymentStatusChange,
  });

  if (session.isPending || (user && submissionQuery.isPending)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (session.isError || submissionQuery.isError || !submission) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="w-full max-w-sm">
          <Alert variant="destructive" className="items-start">
            <CircleAlertIcon />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>
              {submissionQuery.isError
                ? "Failed to load submission details."
                : "Submission not found."}
            </AlertDescription>
          </Alert>
          <Button className="mt-4 w-full" size="lg" render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  const awaitingPayment = submission.status === "AWAITING_PAYMENT";
  const scoreMax = scoreMaximum(submission.scoringSystem);

  return (
    <div className="min-h-screen bg-paper">
      {/* Skip link */}
      <a
        href="#result-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to result content
      </a>

      <Header
        logoHref="/dashboard"
        actions={
          <AccountMenu name={user?.name} email={user?.email} isAdmin={user?.role === "ADMIN"} />
        }
      />

      <main id="result-content" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Breadcrumb */}
        <Breadcrumb className="mb-8">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/dashboard" />}>Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Test result</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Submission header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
              Test result
            </p>
            <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
              {new Date(submission.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </h1>
            <p className="mt-1.5 text-sm text-ink-soft">
              {new Date(submission.createdAt).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <SubmissionStatus status={submission.status} />
        </div>

        {/* Score surface */}
        {!awaitingPayment && (
          <div className="mt-8">
            <ScoreCard
              status={submission.status}
              score={submission.score}
              scoringSystem={submission.scoringSystem}
              rubric={submission.rubric}
              answers={submission.answers}
            />
          </div>
        )}

        {/* Payment notice / banner */}
        {paymentResult === "success" && awaitingPayment && (
          <Alert className="mt-6 items-start">
            <InfoIcon />
            <AlertTitle>Payment submitted</AlertTitle>
            <AlertDescription>
              We&apos;re waiting for iPaymu to confirm your payment. This usually takes a
              few minutes — refresh or check back shortly.
            </AlertDescription>
          </Alert>
        )}

        {/* Payment block */}
        {awaitingPayment && (
          <div className="mt-8 border border-rule bg-paper-raised p-6 sm:p-8">
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                  Payment required
                </p>
                <h2 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink">
                  Have your answers scored
                </h2>
                <p className="mt-1.5 text-sm leading-6 text-ink-soft">
                  Your responses are recorded. Pay once and two certified examiners
                  will mark your pronunciation, fluency, vocabulary and grammar.
                </p>
              </div>
              <Button
                size="lg"
                loading={paying}
                className="shrink-0"
                onClick={handlePay}
              >
                Pay IDR 150,000 with iPaymu
              </Button>
            </div>
            {payError && (
              <Alert variant="destructive" className="mt-5 items-start">
                <CircleAlertIcon />
                <AlertDescription>{payError}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Video answers */}
        {submission.answers.length > 0 ? (
          <div className="mt-10 space-y-8">
            <p className="mark">Answers on record</p>
            {submission.answers.map((answer, index) => (
              <div key={answer.id} className="border border-rule bg-paper-raised">
                <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                      Question {index + 1} · {answer.questionCategory.replace(/_/g, " ")}
                    </p>
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
                </div>

                <div className="px-5 py-4">
                  <LazyAnswerMedia
                    audioUrl={answer.audioUrl}
                    videoUrl={answer.videoUrl}
                    durationSeconds={answer.durationSeconds ?? undefined}
                    questionNumber={index + 1}
                    unavailableMessage={
                      submission.status === "IN_PROGRESS"
                        ? "Video still being processed…"
                        : "Video not available"
                    }
                  />

                  {answer.durationSeconds != null && (
                    <p className="mt-2 font-mono text-[11px] text-ink-faint">
                      Duration · {answer.durationSeconds}s
                    </p>
                  )}

                  {answer.rubric && (
                    <div className="mt-5">
                      <p className="mb-2 mark">Rubric averages</p>
                      <RubricBreakdownView rubric={answer.rubric} compact />
                    </div>
                  )}

                  {answer.score != null && answer.comments.length > 0 && (
                    <div className="mt-5 border-t border-rule pt-4">
                      <p className="mark">Examiner notes</p>
                      <ul className="mt-2.5 space-y-2">
                        {answer.comments.map((comment, commentIndex) => (
                          <li
                            key={`${answer.id}-comment-${commentIndex}`}
                            className="text-sm leading-6 text-ink-soft"
                          >
                            {comment}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-10 border border-dashed border-rule-strong bg-paper-raised px-6 py-12 text-center">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              No answers on record
            </p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-soft">
              No answers were recorded for this submission.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
