"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { CircleAlertIcon, Loader2 } from "lucide-react";
import {
  DASHBOARD_PAGE_SIZE,
  fetchDashboardStats,
  type DashboardStats,
} from "@/lib/dashboard-api";
import { fetchExaminerAssignments } from "@/lib/examiner-api";
import { AssignmentList } from "@/components/examiner/AssignmentList";
import { CameraMicPermissionModal } from "@/components/hardware/CameraMicPermissionModal";
import { StudentDashboard } from "@/components/student/StudentDashboard";
import { Header } from "@/components/layout/Header";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
          <p className="text-sm text-ink-soft">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  // Error state
  if (queryError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="w-full max-w-sm">
          <Alert variant="destructive" className="items-start">
            <CircleAlertIcon />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>Failed to load your profile. Please try again.</AlertDescription>
          </Alert>
          <Button className="mt-4 w-full" size="lg" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
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
    <div className="min-h-screen bg-paper">
      {/* Skip link */}
      <a
        href="#dashboard-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to dashboard content
      </a>

      <Header
        logoHref="/"
        actions={
          <AccountMenu
            name={user?.name}
            email={user?.email}
            isAdmin={false}
          />
        }
      />

      <main id="dashboard-content" className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-2xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
            Examiner dashboard
          </p>
          <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Review and score submissions
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-ink-soft">
            Welcome back{user?.name ? `, ${user.name}` : ""}. Submissions assigned to
            you for scoring appear below.
          </p>
        </div>

        <section className="mt-10">
          <p className="mark">Assigned submissions</p>
          <div className="mt-4">
            <AssignmentList assignments={examinerAssignments} />
          </div>
        </section>
      </main>
    </div>
  );
}
