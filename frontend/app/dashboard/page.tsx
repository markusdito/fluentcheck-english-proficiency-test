"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  DASHBOARD_PAGE_SIZE,
  fetchDashboardStats,
  type DashboardStats,
} from "@/lib/dashboard-api";
import { fetchExaminerAssignments } from "@/lib/examiner-api";
import { ExaminerDashboard } from "@/components/examiner/ExaminerDashboard";
import { CameraMicPermissionModal } from "@/components/hardware/CameraMicPermissionModal";
import { StudentDashboard } from "@/components/student/StudentDashboard";
import { PageState } from "@/components/student/PageShell";
import { h3, primaryButton } from "@/components/student/styles";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ExaminerAssignmentSummary } from "@/types/examiner";
import { useSession } from "@/hooks/useSession";
import { queryKeys } from "@/lib/query-keys";

export default function DashboardPage() {
  const router = useRouter();
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showReviewPipelineNotice, setShowReviewPipelineNotice] = useState(false);
  const [historyCursors, setHistoryCursors] = useState<string[]>([]);
  const session = useSession({ required: true });
  const user = session.data;
  const currentHistoryCursor = historyCursors.at(-1);
  const dashboardParams = currentHistoryCursor
    ? { limit: DASHBOARD_PAGE_SIZE, cursor: currentHistoryCursor }
    : { limit: DASHBOARD_PAGE_SIZE };
  const dashboardQuery = useQuery<DashboardStats>({
    queryKey: queryKeys.studentDashboard(dashboardParams),
    queryFn: ({ signal }) => fetchDashboardStats(dashboardParams, signal),
    enabled: user?.role === "STUDENT",
    // keep the current page mounted while the next history page loads
    placeholderData: keepPreviousData,
  });
  const assignmentsQuery = useQuery<ExaminerAssignmentSummary[]>({
    queryKey: queryKeys.examinerAssignments,
    queryFn: ({ signal }) => fetchExaminerAssignments(signal),
    enabled: user?.role === "EXAMINER",
  });

  useEffect(() => {
    if (user?.role === "ADMIN") router.replace("/admin");
  }, [router, user?.role]);

  const dashboard = dashboardQuery.data;
  const examinerAssignments = assignmentsQuery.data ?? [];
  const dataLoading =
    (user?.role === "STUDENT" && dashboardQuery.isPending) ||
    (user?.role === "EXAMINER" && assignmentsQuery.isPending);
  const queryError =
    session.error ?? dashboardQuery.error ?? assignmentsQuery.error;
  const historyPageNumber = historyCursors.length + 1;

  // Loading state
  if (
    session.isPending ||
    (!user && !queryError) ||
    dataLoading ||
    user?.role === "ADMIN"
  ) {
    return (
      <PageState>
        <Loader2 className="mx-auto size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
        <p className="mt-4 text-sm text-sn-muted">Loading your dashboard…</p>
      </PageState>
    );
  }

  // Error state
  if (queryError) {
    return (
      <PageState>
        <h1 className={h3}>Something went wrong</h1>
        <p className="mt-2 text-[15px] text-sn-muted">Failed to load your dashboard. Please try again.</p>
        <button type="button" className={`${primaryButton} mt-5 w-full`} onClick={() => window.location.reload()}>
          Try again
        </button>
      </PageState>
    );
  }

  const isExaminer = user?.role === "EXAMINER";

  // The Active Submission (still recording) is excluded from the dashboard
  // history and is resumed by the test route instead. A Review-pipeline
  // submission (payment/scoring) is the newest history row and blocks a new
  // Assessment start.
  const REVIEW_PIPELINE_STATUSES = ["AWAITING_PAYMENT", "PAID", "SCORING"];
  const hasReviewPipelineSubmission =
    dashboard?.submissions.some((sub) => REVIEW_PIPELINE_STATUSES.includes(sub.status)) ??
    false;

  const handleStartAssessment = () => {
    if (hasReviewPipelineSubmission) {
      setShowReviewPipelineNotice(true);
      return;
    }
    setShowPermissionModal(true);
  };

  const modals = (
    <>
      <CameraMicPermissionModal
        open={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
        onComplete={() => {
          setShowPermissionModal(false);
          router.push("/test/demo-test");
        }}
      />

      <AlertDialog
        open={showReviewPipelineNotice}
        onOpenChange={setShowReviewPipelineNotice}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Previous submission still being reviewed</AlertDialogTitle>
            <AlertDialogDescription>
              Your previous submission is still moving through payment and scoring.
              You can start a new assessment once it has been scored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (!isExaminer) {
    return (
      <>
        <StudentDashboard
          name={user?.name ?? ""}
          email={user?.email ?? ""}
          dashboard={dashboard}
          page={historyPageNumber}
          canPrev={historyCursors.length > 0 && !dashboardQuery.isFetching}
          canNext={
            !!dashboard?.pagination.hasMore &&
            dashboard.pagination.nextCursor != null &&
            !dashboardQuery.isFetching
          }
          onPrev={() => setHistoryCursors((cursors) => cursors.slice(0, -1))}
          onNext={() => {
            const nextCursor = dashboard?.pagination.nextCursor;
            if (nextCursor) setHistoryCursors((cursors) => [...cursors, nextCursor]);
          }}
          onStart={handleStartAssessment}
        />
        {modals}
      </>
    );
  }

  return (
    <ExaminerDashboard
      name={user?.name ?? ""}
      email={user?.email ?? ""}
      assignments={examinerAssignments}
    />
  );
}
