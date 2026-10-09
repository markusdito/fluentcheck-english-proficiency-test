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
import { TestTutorial, readTutorialSeen } from "@/components/student/TestTutorial";
import { PracticeChoiceDialog } from "@/components/student/PracticeChoiceDialog";
import { PageState } from "@/components/student/PageShell";
import { h3, primaryButton } from "@/components/student/styles";
import type { ExaminerAssignmentSummary } from "@/types/examiner";
import { useSession } from "@/hooks/useSession";
import { queryKeys } from "@/lib/query-keys";

export default function DashboardPage() {
  const router = useRouter();
  // The device check leads to the real test or the practice run.
  const [startTarget, setStartTarget] = useState<"/test/demo-test" | "/test/practice" | null>(null);
  // "Start speaking test" first asks: practice run or the real test.
  const [showChoice, setShowChoice] = useState(false);
  // null = not decided yet; first-timers (no past tests, never dismissed) get it on load.
  const [showTutorial, setShowTutorial] = useState<boolean | null>(null);
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

  useEffect(() => {
    if (showTutorial !== null || user?.role !== "STUDENT" || !dashboard) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowTutorial(dashboard.totalTests === 0 && !readTutorialSeen());
  }, [showTutorial, user?.role, dashboard]);

  // "Take the real test" after practice lands here to run consent + system check.
  useEffect(() => {
    if (user?.role !== "STUDENT" || new URLSearchParams(window.location.search).get("start") !== "real") return;
    router.replace("/dashboard");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartTarget("/test/demo-test");
  }, [router, user?.role]);

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

  // Only students who never took a real test are offered practice first;
  // practice creates no Submission, so it never counts toward totalTests.
  const startTest = () => {
    if (dashboard?.totalTests === 0) setShowChoice(true);
    else setStartTarget("/test/demo-test");
  };

  const modals = (
    <>
      <TestTutorial
        open={showTutorial === true}
        onClose={() => setShowTutorial(false)}
        onStart={startTest}
      />
      <PracticeChoiceDialog
        open={showChoice}
        onClose={() => setShowChoice(false)}
        onChoose={(practice) => {
          setShowChoice(false);
          setStartTarget(practice ? "/test/practice" : "/test/demo-test");
        }}
      />
      <CameraMicPermissionModal
        open={startTarget !== null}
        onClose={() => setStartTarget(null)}
        onComplete={() => {
          if (startTarget) router.push(startTarget);
          setStartTarget(null);
        }}
      />
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
          onStart={startTest}
          onTutorial={() => setShowTutorial(true)}
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
