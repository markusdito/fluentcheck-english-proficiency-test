"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, Loader2 } from "lucide-react";
import {
  completeExaminerScoring,
  fetchExaminerAssignmentDetail,
  saveExaminerAnswerScore,
} from "@/lib/examiner-api";
import { useSession } from "@/hooks/useSession";
import { queryKeys } from "@/lib/query-keys";
import { VideoReviewer } from "@/components/examiner/VideoReviewer";
import { ScoringPanel } from "@/components/examiner/ScoringPanel";
import { Header } from "@/components/layout/Header";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { SubmissionStatus } from "@/components/ui/submission-status";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { AssignmentDetail } from "@/types/examiner";
import type { ScoreSubmissionInput } from "@/types/scoring";

export default function AssignmentReviewPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = use(params);
  const queryClient = useQueryClient();
  const session = useSession({ required: true });
  const user = session.data;
  const assignmentKey = queryKeys.examinerAssignment(assignmentId);
  const canWorkExistingAssignment =
    user?.role === "EXAMINER" || user?.role === "ADMIN";
  const assignmentQuery = useQuery({
    queryKey: assignmentKey,
    queryFn: ({ signal }) =>
      fetchExaminerAssignmentDetail(assignmentId, signal),
    enabled: canWorkExistingAssignment,
  });
  const assignment = assignmentQuery.data;
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const initializedAssignmentId = useRef<string | null>(null);

  useEffect(() => {
    if (user && !canWorkExistingAssignment) {
      window.location.replace("/dashboard");
    }
  }, [canWorkExistingAssignment, user]);

  useEffect(() => {
    if (!assignment || initializedAssignmentId.current === assignment.id) return;
    initializedAssignmentId.current = assignment.id;
    const firstUnsaved = assignment.answers.findIndex(
      (answer) => answer.savedScore == null,
    );
    setCurrentQuestionIndex(
      firstUnsaved >= 0
        ? firstUnsaved
        : Math.max(0, assignment.answers.length - 1),
    );
  }, [assignment]);

  const handleSaveScore = async (score: ScoreSubmissionInput) => {
    if (!assignment) return;
    setSubmitting(true);

    try {
      await saveExaminerAnswerScore(assignmentId, score);
      const rubric = "rubric" in score ? score.rubric : null;
      const value =
        "rubric" in score
          ? (score.rubric.pronunciation +
              score.rubric.fluency +
              score.rubric.vocabulary +
              score.rubric.grammar) /
            4
          : score.value;
      const savedScore = {
        value,
        rubric,
        comment: score.comment?.trim() || null,
      };
      queryClient.setQueryData<AssignmentDetail>(assignmentKey, (current) =>
        current
          ? {
              ...current,
              status: "IN_PROGRESS",
              answers: current.answers.map((answer) =>
                answer.id === score.answerId
                  ? { ...answer, savedScore }
                  : answer,
              ),
            }
          : current,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteScoring = async () => {
    setSubmitting(true);
    try {
      await completeExaminerScoring(assignmentId);
      queryClient.setQueryData<AssignmentDetail>(assignmentKey, (current) =>
        current ? { ...current, status: "COMPLETED" } : current,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.examinerAssignments,
      });
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (
    session.isPending ||
    (canWorkExistingAssignment && assignmentQuery.isPending) ||
    (user && !canWorkExistingAssignment)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (session.isError || assignmentQuery.isError || !assignment) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-sm text-ink-soft">
            {assignmentQuery.error instanceof Error
              ? assignmentQuery.error.message
              : "Assignment not found"}
          </p>
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
        actions={
          <AccountMenu
            name={user?.name}
            email={user?.email}
            isAdmin={user?.role === "ADMIN"}
          />
        }
      />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <Breadcrumb className="mb-8">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/dashboard" />}>
                Dashboard
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Submission details</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

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

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-5">
          {/* Video review — takes 3/5 columns */}
          <div className="min-w-0 lg:col-span-3">
            <p className="mark">Recordings</p>
            <h2 className="mt-1.5 mb-4 font-display text-2xl font-medium tracking-tight text-ink">
              Review recordings
            </h2>
            <VideoReviewer
              answers={assignment.answers}
              currentIndex={currentQuestionIndex}
            />
          </div>

          {/* Scoring panel — takes 2/5 columns */}
          <div className="min-w-0 lg:col-span-2">
            {assignment.status !== "COMPLETED" ? (
              <ScoringPanel
                answers={assignment.answers}
                scoringSystem={assignment.scoringSystem}
                currentIndex={currentQuestionIndex}
                onQuestionChange={setCurrentQuestionIndex}
                onSave={handleSaveScore}
                onComplete={handleCompleteScoring}
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
