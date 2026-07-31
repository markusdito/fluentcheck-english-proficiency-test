"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { fetchSubmissionDetail, paySubmission, type SubmissionDetail } from "@/lib/dashboard-api";
import VideoPlayer from "@/components/VideoPlayer";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function SubmissionResultPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = use(params);
  const searchParams = useSearchParams();
  const paymentResult = searchParams.get("payment");
  const [user, setUser] = useState<User | null>(null);
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [userData, submissionData] = await Promise.all([
          api.get<{ status: string; data: { user: User } }>("/auth/me"),
          fetchSubmissionDetail(submissionId),
        ]);
        if (!cancelled) {
          setUser(userData.data.user);
          setSubmission(submissionData);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 401) {
          window.location.href = "/login";
          return;
        }
        setError("Failed to load submission details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

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

  useEffect(() => {
    if (paymentResult !== "success" || submission?.status !== "AWAITING_PAYMENT") {
      return;
    }

    let cancelled = false;
    const pollPaymentStatus = async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (cancelled) return;

        try {
          const updated = await fetchSubmissionDetail(submissionId);
          if (cancelled) return;
          setSubmission(updated);
          if (updated.status !== "AWAITING_PAYMENT") return;
        } catch {
          return;
        }
      }
    };

    void pollPaymentStatus();
    return () => {
      cancelled = true;
    };
  }, [paymentResult, submission?.status, submissionId]);

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } finally {
      window.location.href = "/";
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-(--border) border-t-[var(--primary)]"
            role="status"
            aria-label="Loading"
          />
          <p className="text-sm text-[var(--muted)]">Loading submission…</p>
        </div>
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="max-w-sm rounded-xl border border-[var(--border)] bg-white p-8 text-center shadow-lg">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg className="h-6 w-6 text-[var(--danger)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.94 7.94a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM8 10a.75.75 0 01.75-.75h.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-2.75H8.75A.75.75 0 018 10z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-[var(--foreground)]">
            Something went wrong
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">{error || "Submission not found."}</p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-5 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-dark)]"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Top navigation */}
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--foreground)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2a3 3 0 00-3 3v1H7a3 3 0 00-3 3v1a3 3 0 000 6v1a3 3 0 003 3h2v1a3 3 0 006 0v-1h2a3 3 0 003-3v-1a3 3 0 000-6v-1a3 3 0 00-3-3h-2V5a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </span>
            FluentCheck
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm font-medium text-[var(--muted)] sm:block">
              {user?.name}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--danger)]"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 sm:py-12">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          Back to Dashboard
        </Link>

        {/* Submission header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
            Test Result
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-sm text-[var(--muted)]">
              {new Date(submission.createdAt).toLocaleDateString("en-US", {
                year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                submission.status === "CERTIFIED"
                  ? "bg-emerald-50 text-emerald-700"
                  : submission.status === "SCORED"
                    ? "bg-blue-50 text-blue-700"
                    : submission.status === "AWAITING_PAYMENT"
                      ? "bg-amber-50 text-amber-700"
                      : submission.status === "IN_PROGRESS"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-zinc-100 text-zinc-600"
              }`}
            >
              {submission.status.replace(/_/g, " ")}
            </span>
            {submission.score != null && (
              <span className="text-sm font-semibold text-[var(--foreground)]">
                Score: {submission.score}
              </span>
            )}
          </div>
        </div>

        {/* Pay CTA for AWAITING_PAYMENT submissions */}
        {paymentResult === "success" && submission.status === "AWAITING_PAYMENT" && (
          <div className="mb-8 rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-800">
            Payment submitted. We are waiting for iPaymu to confirm your payment.
          </div>
        )}

        {paymentResult === "cancelled" && submission.status === "AWAITING_PAYMENT" && (
          <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            Payment was cancelled. You can try again when you are ready.
          </div>
        )}

        {submission.status === "AWAITING_PAYMENT" && (
          <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--foreground)]">Payment Required</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Your answers have been recorded. Pay to have them scored by our examiners.
                </p>
              </div>
              <button
                onClick={handlePay}
                disabled={paying}
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-6 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {paying ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Processing...
                  </span>
                ) : (
                  "Pay IDR 150,000 with iPaymu"
                )}
              </button>
            </div>
            {payError && (
              <p className="mt-3 text-sm text-red-600">{payError}</p>
            )}
          </div>
        )}

        {/* Video answers */}
        {submission.answers.length > 0 ? (
          <div className="space-y-6">
            {submission.answers.map((answer, index) => (
              <div
                key={answer.id}
                className="overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm"
              >
                <div className="border-b border-[var(--border)] bg-zinc-50 px-6 py-4">
                  <h2 className="text-base font-semibold text-[var(--foreground)]">
                    Question {index + 1}
                  </h2>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {answer.questionCategory.replace(/_/g, " ")}
                  </p>
                </div>
                <div className="px-6 py-4">
                  <p className="mb-4 text-sm text-[var(--foreground)]">
                    {answer.promptText}
                  </p>
                  {answer.videoUrl ? (
                    <VideoPlayer src={answer.videoUrl} durationSeconds={answer.durationSeconds ?? undefined} />
                  ) : (
                    <div className="rounded-lg border border-dashed border-[var(--border)] bg-zinc-50 p-8 text-center">
                      <p className="text-sm text-[var(--muted)]">
                        {submission.status === "IN_PROGRESS"
                          ? "Video still being processed…"
                          : "Video not available"}
                      </p>
                    </div>
                  )}
                  {answer.durationSeconds != null && (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Duration: {answer.durationSeconds}s
                    </p>
                  )}

                  <section
                    aria-label={`Score and feedback for question ${index + 1}`}
                    className="mt-5 rounded-lg border border-[var(--border)] bg-zinc-50 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--foreground)]">
                          Video score
                        </h3>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          Based on examiner evaluations
                        </p>
                      </div>
                      {answer.score != null ? (
                        <p className="text-lg font-bold text-[var(--primary)]">
                          {answer.score.toFixed(2)} / 100
                        </p>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                          Pending
                        </span>
                      )}
                    </div>

                    {answer.score == null ? (
                      <p className="mt-3 text-sm text-[var(--muted)]">
                        This video has not been scored yet.
                      </p>
                    ) : answer.comments.length > 0 ? (
                      <div className="mt-4 border-t border-[var(--border)] pt-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                          Examiner comments
                        </h4>
                        <ul className="mt-2 space-y-2">
                          {answer.comments.map((comment, commentIndex) => (
                            <li
                              key={`${answer.id}-comment-${commentIndex}`}
                              className="text-sm leading-6 text-[var(--foreground)]"
                            >
                              {comment}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-[var(--muted)]">
                        No comments were provided for this video.
                      </p>
                    )}
                  </section>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
            <p className="text-sm text-[var(--muted)]">No answers recorded for this submission.</p>
          </div>
        )}
      </main>
    </div>
  );
}
