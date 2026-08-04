"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { CircleCheckIcon, Loader2 } from "lucide-react";
import {
  fetchExaminerAssignmentDetail,
  startExaminerAssignment,
  submitExaminerScores,
} from "@/lib/examiner-api";
import { api } from "@/lib/api";
import { VideoReviewer } from "@/components/examiner/VideoReviewer";
import { ScoringPanel } from "@/components/examiner/ScoringPanel";
import { Header } from "@/components/layout/Header";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { SubmissionStatus } from "@/components/ui/submission-status";
import { Stamp } from "@/components/ui/Stamp";
import { Button } from "@/components/ui/button";
import type { AssignmentDetail } from "@/types/examiner";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function AssignmentReviewPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = use(params);

  const [user, setUser] = useState<User | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [userData, assignmentData] = await Promise.all([
          api.get<{ status: string; data: { user: User } }>("/auth/me"),
          fetchExaminerAssignmentDetail(assignmentId),
        ]);
        if (!cancelled) {
          setUser(userData.data.user);
          setAssignment(assignmentData);
        }
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-sm text-ink-soft">{error ?? "Assignment not found"}</p>
          <Button className="mt-6" size="lg" render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-md border border-verified/40 bg-verified/15">
            <CircleCheckIcon className="size-10 text-verified" />
          </div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Marking complete
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Scores submitted
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            Your scores for {assignment.studentName}&apos;s submission have been
            recorded.
          </p>
          <div className="mt-8 flex justify-center">
            <Button size="lg" render={<Link href="/dashboard" />}>
              Back to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <Header
        logoHref="/dashboard"
        nav={
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft transition-colors hover:text-ink"
          >
            Dashboard
          </Link>
        }
        actions={
          <AccountMenu
            name={user?.name}
            email={user?.email}
            isAdmin={user?.role === "ADMIN"}
          />
        }
      />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Student info header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex size-12 items-center justify-center border border-rule bg-rule/30 font-display text-2xl font-medium text-ink-soft">
              {assignment.studentName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-2xl font-medium tracking-tight text-ink sm:text-3xl">
                  {assignment.studentName}
                </h1>
                <SubmissionStatus status={assignment.status} />
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                Submission · {assignment.answers.length} question
                {assignment.answers.length === 1 ? "" : "s"} ·{" "}
                {new Date(assignment.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Assigned examiners */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Assigned examiners
          </span>
          {assignment.examiners.map((ex) => (
            <Stamp key={ex.id} tone={ex.status === "COMPLETED" ? "verified" : "ink"}>
              {ex.name}
            </Stamp>
          ))}
        </div>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* Video review — takes 3/5 columns */}
          <div className="lg:col-span-3">
            <p className="mark">Recordings</p>
            <h2 className="mt-1.5 mb-4 font-display text-2xl font-medium tracking-tight text-ink">
              Review recordings
            </h2>
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
              <div className="border border-rule bg-paper-raised p-6">
                <div className="flex items-center gap-2 text-verified">
                  <CircleCheckIcon className="size-5" />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em]">
                    Scoring completed
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
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
