"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  fetchExaminerAssignmentDetail,
  startExaminerAssignment,
  submitExaminerScores,
} from "@/lib/examiner-api";
import { VideoReviewer } from "@/components/examiner/VideoReviewer";
import { ScoringPanel } from "@/components/examiner/ScoringPanel";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import type { AssignmentDetail } from "@/types/examiner";

export default function AssignmentReviewPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = use(params);

  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchExaminerAssignmentDetail(assignmentId);
        if (!cancelled) setAssignment(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load assignment");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assignmentId]);

  const handleSubmitScores = async (
    scores: Array<{ answerId: string; value: number; comment?: string }>
  ) => {
    if (!assignment) return;
    setSubmitting(true);

    try {
      // Start the assignment if it's still ASSIGNED
      if (assignment.status === "ASSIGNED") {
        await startExaminerAssignment(assignmentId);
      }

      await submitExaminerScores(assignmentId, scores);
      setSubmitted(true);
    } catch (err) {
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge: Record<string, { bg: string; text: string; label: string }> = {
    ASSIGNED: { bg: "bg-amber-50", text: "text-amber-700", label: "Assigned" },
    IN_PROGRESS: { bg: "bg-blue-50", text: "text-blue-700", label: "In Progress" },
    COMPLETED: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Completed" },
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
        <div className="max-w-sm rounded-xl border border-[var(--border)] bg-white p-8 text-center shadow-lg">
          <p className="text-sm text-[var(--foreground)]">{error ?? "Assignment not found"}</p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-5 text-sm font-medium text-white hover:bg-[var(--primary-dark)]"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const badge = statusBadge[assignment.status] ?? statusBadge.ASSIGNED;

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20">
            <svg className="h-10 w-10 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Scores Submitted</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Your scores for {assignment.studentName}&apos;s submission have been recorded.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
            href="/dashboard"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-6 text-sm font-medium text-white hover:bg-[var(--primary-dark)]"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold text-[var(--foreground)]">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
              Dashboard
            </Link>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Student info header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200">
              <span className="text-lg font-semibold text-zinc-600">
                {assignment.studentName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-[var(--foreground)] sm:text-2xl">
                {assignment.studentName}
              </h1>
              <p className="text-sm text-[var(--muted)]">
                Submission &middot; {assignment.answers.length} questions &middot;{" "}
                {new Date(assignment.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
          </div>
        </div>

        {/* Assigned examiners */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--muted)]">Assigned examiners:</span>
          {assignment.examiners.map((ex) => {
            const exBadge = ex.status === "COMPLETED"
              ? "bg-emerald-50 text-emerald-700"
              : ex.status === "IN_PROGRESS"
                ? "bg-blue-50 text-blue-700"
                : "bg-amber-50 text-amber-700";
            return (
              <span
                key={ex.id}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${exBadge}`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/50 text-[10px] font-bold">
                  {ex.name.charAt(0).toUpperCase()}
                </span>
                {ex.name}
              </span>
            );
          })}
        </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* Video review — takes 3/5 columns */}
          <div className="lg:col-span-3">
            <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Review Recordings</h2>
            <VideoReviewer answers={assignment.answers} />
          </div>

          {/* Scoring panel — takes 2/5 columns */}
          <div className="lg:col-span-2">
            {assignment.status !== "COMPLETED" ? (
              <ScoringPanel
                answers={assignment.answers}
                assignmentId={assignmentId}
                onSubmit={handleSubmitScores}
                isSubmitting={submitting}
              />
            ) : (
              <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-emerald-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <span className="text-sm font-medium">Scoring completed</span>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  You have already submitted scores for this assignment.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
