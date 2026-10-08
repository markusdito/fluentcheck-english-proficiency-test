"use client";

import { slotLabel } from "@/lib/assessment-slots";
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
import { refreshExaminerWorkAfterOwnershipConflict } from "@/lib/examiner-ownership";
import { VideoReviewer } from "@/components/examiner/VideoReviewer";
import { ScoringPanel } from "@/components/examiner/ScoringPanel";
import { AssignmentPill, submissionRef } from "@/components/examiner/ExaminerDashboard";
import { BackLink, PageShell, PageState } from "@/components/student/PageShell";
import { formatDate } from "@/components/student/ResultCards";
import { card, h2, h3, meta, primaryButton, secondaryButton } from "@/components/student/styles";
import type { AssignmentDetail } from "@/types/examiner";
import type { ScoreSubmissionInput } from "@/types/scoring";

export default function AssignmentReviewPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = use(params);
  const queryClient = useQueryClient();
  const session = useSession({ required: true });
  const user = session.data;
  const homeHref = user?.role === "ADMIN" ? "/admin" : "/dashboard";
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
    } catch (error) {
      refreshExaminerWorkAfterOwnershipConflict(error, queryClient, assignmentKey);
      throw error;
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
    } catch (error) {
      refreshExaminerWorkAfterOwnershipConflict(error, queryClient, assignmentKey);
      throw error;
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
      <PageState>
        <Loader2 className="mx-auto size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
        <p className="mt-4 text-sm text-sn-muted">Opening submission…</p>
      </PageState>
    );
  }

  if (session.isError || assignmentQuery.isError || !assignment || !user) {
    return (
      <PageState>
        <h1 className={h3}>Submission unavailable</h1>
        <p className="mt-2 text-[15px] text-sn-muted">
          {assignmentQuery.error instanceof Error ? assignmentQuery.error.message : "Assignment not found"}
        </p>
        <Link href={homeHref} className={`${primaryButton} mt-5 w-full`}>
          Back to dashboard
        </Link>
      </PageState>
    );
  }

  const ref = submissionRef(assignment.submissionId);
  const shell = {
    name: user.name,
    email: user.email,
    label: user.role === "ADMIN" ? "Admin" : "Examiner",
    homeHref,
    contentId: "scoring-content",
    skipLabel: "Skip to scoring",
  };
  const backLabel = user.role === "ADMIN" ? "Back to admin panel" : "Back to dashboard";

  if (submitted) {
    return (
      <PageShell {...shell}>
        <div className={`${card} mx-auto max-w-lg text-center`}>
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-sn-field-green text-sn-ink-green">
            <CircleCheckIcon className="size-8" strokeWidth={1.6} aria-hidden="true" />
          </div>
          <h1 className={`${h2} mt-5`}>Scores submitted</h1>
          <p className="mt-3 text-[15px] text-sn-muted">
            Your scoring for {ref} is final. The report shows the mean of both examiners once the second scoring is in.
          </p>
          <Link href={homeHref} className={`${primaryButton} mt-6`}>
            {backLabel}
          </Link>
        </div>
      </PageShell>
    );
  }

  const totalSeconds = assignment.answers.reduce((t, a) => t + (a.durationSeconds ?? 0), 0);

  return (
    <PageShell {...shell}>
      <div className="flex flex-col items-start gap-3">
        <BackLink href={homeHref}>{backLabel}</BackLink>
        <div className="flex w-full flex-wrap items-center justify-between gap-4">
          <h1 className={h2}>Submission {ref}</h1>
          <AssignmentPill a={assignment} />
        </div>
      </div>

      <dl className="mt-6 mb-10 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-6 gap-y-4">
        {[
          ["Candidate", assignment.studentName],
          ["Test Set", assignment.testSet?.code ?? "—"],
          ["Assigned", formatDate(assignment.createdAt)],
          ["Answers", String(assignment.answers.length)],
          ["Total audio", totalSeconds ? `${Math.floor(totalSeconds / 60)} m ${totalSeconds % 60} s` : "—"],
          ["Scale", assignment.scoringSystem === "RUBRIC_6" ? "Band 1–6" : "Legacy 0–100"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className={meta}>{k}</dt>
            <dd className="m-0 mt-0.5 font-medium tabular-nums [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>

      {assignment.status !== "COMPLETED" ? (
        <ScoringPanel
          answers={assignment.answers}
          scoringSystem={assignment.scoringSystem}
          currentIndex={currentQuestionIndex}
          onQuestionChange={setCurrentQuestionIndex}
          onSave={handleSaveScore}
          onComplete={handleCompleteScoring}
          isSubmitting={submitting}
        >
          <VideoReviewer answers={assignment.answers} currentIndex={currentQuestionIndex} />
        </ScoringPanel>
      ) : (
        <div className="grid items-start gap-7 min-[921px]:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            <VideoReviewer answers={assignment.answers} currentIndex={currentQuestionIndex} />
            {assignment.answers.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Answers">
                {assignment.answers.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={i === currentQuestionIndex}
                    onClick={() => setCurrentQuestionIndex(i)}
                    className={`${secondaryButton} aria-pressed:border-sn-fg aria-pressed:bg-sn-fg/6`}
                  >
                    {slotLabel(a.questionCategory)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <aside className={card}>
            <h2 className={h3}>Scoring completed</h2>
            <p className="mt-2 text-sm text-sn-muted">You have already submitted final scores for this submission.</p>
          </aside>
        </div>
      )}
    </PageShell>
  );
}
