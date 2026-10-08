"use client";

import { slotLabel, testSetLabel } from "@/lib/assessment-slots";
import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { BackLink, PageShell, PageState } from "@/components/student/PageShell";
import { StatusPill } from "@/components/student/StatusPill";
import { card, h2, h3, meta, primaryButton, statNum } from "@/components/student/styles";
import { RUBRIC_CRITERIA, scoreMaximum } from "@/types/scoring";

const CRITERION_LABELS = {
  pronunciation: "Pronunciation",
  fluency: "Fluency",
  vocabulary: "Vocabulary",
  grammar: "Grammar",
} as const;

const REVIEW_STATUSES = new Set(["PAID", "SCORING"]);

const categoryLabel = slotLabel;

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
      <PageState>
        <Loader2 className="mx-auto size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
      </PageState>
    );
  }

  if (session.isError || submissionQuery.isError || !submission) {
    return (
      <PageState>
        <h1 className={h3}>Something went wrong</h1>
        <p className="mt-2 text-[15px] text-sn-muted">
          {submissionQuery.isError ? "Failed to load submission details." : "Submission not found."}
        </p>
        <Link href="/dashboard" className={`${primaryButton} mt-5 w-full`}>
          Back to dashboard
        </Link>
      </PageState>
    );
  }

  const awaitingPayment = submission.status === "AWAITING_PAYMENT";
  const inReview = REVIEW_STATUSES.has(submission.status);
  const rubric6 = submission.scoringSystem === "RUBRIC_6";
  const scoreMax = scoreMaximum(submission.scoringSystem);
  const overall = submission.score != null ? Number(submission.score) : null;
  const fmt = (v: number) => (rubric6 ? v.toFixed(2) : String(v));
  const created = new Date(submission.createdAt);
  const dateText = created.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const homeHref = user?.role === "ADMIN" ? "/admin" : "/dashboard";
  const notes = submission.answers.flatMap((answer) =>
    answer.score != null ? answer.comments.map((c) => ({ part: categoryLabel(answer.questionCategory), text: c })) : [],
  );

  return (
    <PageShell
      name={user?.name ?? ""}
      email={user?.email ?? ""}
      homeHref={homeHref}
      contentId="result-content"
      skipLabel="Skip to result content"
    >
      <div className="flex flex-col items-start gap-3">
        <BackLink href={homeHref}>{user?.role === "ADMIN" ? "Back to admin panel" : "Back to dashboard"}</BackLink>
        <h1 className={h2}>Result report</h1>
        <p className={meta}>
          {dateText} ·{" "}
          {created.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          {submission.testSet && ` · ${testSetLabel(submission.testSet)}`}
        </p>
      </div>

      {paymentResult === "success" && awaitingPayment && (
        <p className="mt-6 rounded-[10px] bg-sn-field-navy p-4 text-[15px]" role="status">
          <b className="font-semibold">Payment submitted.</b> We&apos;re waiting for iPaymu to confirm
          your payment. This usually takes a few minutes; refresh or check back shortly.
        </p>
      )}

      <div className="mt-8 grid items-start gap-8 min-[921px]:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-7">
          {awaitingPayment ? (
            <article className={card}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className={meta}>Payment required</p>
                  <h2 className={`${h3} mt-2`}>Have your answers scored</h2>
                </div>
                <StatusPill status={submission.status} />
              </div>
              <p className="mt-2 max-w-[60ch] text-[15px] text-sn-muted">
                Your responses are recorded. Pay once and two certified examiners will mark your
                pronunciation, fluency, vocabulary and grammar.
              </p>
              {payError && (
                <p className="mt-5 rounded-[10px] bg-sn-danger/6 p-4 text-[15px] font-medium text-sn-danger" role="alert">
                  {payError}
                </p>
              )}
              <div className="mt-5 flex justify-end">
                <button type="button" className={primaryButton} disabled={paying} onClick={handlePay}>
                  {paying && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  Pay IDR 150,000 with iPaymu
                </button>
              </div>
            </article>
          ) : (
            <article className={card}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className={meta}>{rubric6 ? "Overall band" : "Legacy score"}</p>
                  <h2 className={`${h3} mt-2`}>
                    {inReview ? "Being reviewed" : submission.status === "ABANDONED" ? "No band" : "Your result"}
                  </h2>
                </div>
                <StatusPill status={submission.status} />
              </div>
              {inReview ? (
                <p className="mt-3 max-w-[60ch] text-[15px] text-sn-muted">
                  Two examiners are scoring your recording independently. Your band appears here
                  once both have finished.
                </p>
              ) : overall != null && Number.isFinite(overall) ? (
                <div className="mt-3 flex flex-wrap items-baseline gap-4">
                  <div className={`${statNum} text-[length:clamp(56px,8vw,96px)]`}>{fmt(overall)}</div>
                  <p className="m-0 max-w-[28ch] text-[15px] text-sn-muted">
                    Out of {scoreMax}. {rubric6 ? "Mean of every stored score across answers and examiners." : ""}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-[15px] text-sn-muted">This submission has no score.</p>
              )}
              {rubric6 && submission.rubric && !inReview && (
                <dl className="mt-5 mb-0">
                  {RUBRIC_CRITERIA.map((c) => (
                    <div key={c} className="flex items-center justify-between gap-5 border-t border-sn-border py-4">
                      <dt className="text-sm text-sn-muted">{CRITERION_LABELS[c]}</dt>
                      <dd className="m-0 tabular-nums">{submission.rubric![c].toFixed(2)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>
          )}

          {submission.answers.length > 0 && !awaitingPayment && (
            <article className={card}>
              <h2 className={h3}>Per answer breakdown</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-[0.04em] text-sn-muted">
                      <th scope="col" className="border-b border-sn-border px-2 py-3 text-left font-medium sm:px-3.5">Part</th>
                      {rubric6 &&
                        RUBRIC_CRITERIA.map((c) => (
                          <th key={c} scope="col" className="hidden border-b border-sn-border px-3.5 py-3 text-right font-medium md:table-cell">
                            {CRITERION_LABELS[c]}
                          </th>
                        ))}
                      <th scope="col" className="border-b border-sn-border px-2 py-3 text-right font-medium sm:px-3.5">Mean</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submission.answers.map((answer) => (
                      <tr key={answer.id} className="hover:bg-sn-fg/6">
                        <th scope="row" className="border-b border-sn-border px-2 py-3 text-left font-normal sm:px-3.5">{categoryLabel(answer.questionCategory)}</th>
                        {rubric6 &&
                          RUBRIC_CRITERIA.map((c) => (
                            <td key={c} className="hidden border-b border-sn-border px-3.5 py-3 text-right tabular-nums md:table-cell">
                              {answer.rubric ? answer.rubric[c].toFixed(2) : "—"}
                            </td>
                          ))}
                        <td className="border-b border-sn-border px-2 py-3 text-right tabular-nums sm:px-3.5">
                          {answer.score != null ? fmt(answer.score) : <span className="text-sn-muted">Not scored</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={`${meta} mt-3`}>Examiners stay anonymous</p>
            </article>
          )}

          {notes.length > 0 && (
            <article className={card}>
              <h2 className={h3}>Written feedback</h2>
              <ul className="mt-3 mb-0 list-none p-0">
                {notes.map((n, i) => (
                  <li key={i} className="border-t border-sn-border py-4 first:border-t-0 first:pt-1">
                    <p className={meta}>{n.part}</p>
                    <p className="mt-1 mb-0 text-[15px] text-sn-muted">{n.text}</p>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </div>

        <aside className={card} aria-labelledby="recordings-title">
          <h2 id="recordings-title" className={h3}>Your recordings</h2>
          <p className="mt-1.5 mb-2 text-[15px] text-sn-muted">Streaming preview only. Recordings can&apos;t be downloaded.</p>
          {submission.answers.length > 0 ? (
            submission.answers.map((answer, index) => (
              <div key={answer.id} className="border-t border-sn-border py-5">
                <p className={`${meta} mb-3`}>
                  {categoryLabel(answer.questionCategory)}
                  {answer.durationSeconds != null ? ` · ${answer.durationSeconds}s` : ""}
                </p>
                <LazyAnswerMedia
                  audioUrl={answer.audioUrl}
                  videoUrl={answer.videoUrl}
                  durationSeconds={answer.durationSeconds ?? undefined}
                  questionNumber={index + 1}
                  unavailableMessage={
                    submission.status === "IN_PROGRESS" ? "Video still being processed…" : "Video not available"
                  }
                />
              </div>
            ))
          ) : (
            <p className="border-t border-sn-border pt-5 text-[15px] text-sn-muted">No answers were recorded for this submission.</p>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
