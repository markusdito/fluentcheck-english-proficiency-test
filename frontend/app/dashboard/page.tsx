"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRightIcon, CircleAlertIcon, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { fetchDashboardStats, type DashboardStats } from "@/lib/dashboard-api";
import { fetchExaminerAssignments } from "@/lib/examiner-api";
import { AssignmentList } from "@/components/examiner/AssignmentList";
import { CameraMicPermissionModal } from "@/components/hardware/CameraMicPermissionModal";
import { Header } from "@/components/layout/Header";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import { BandGauge } from "@/components/ui/BandGauge";
import { SubmissionStatus } from "@/components/ui/submission-status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ExaminerAssignmentSummary } from "@/types/examiner";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  targetScore?: number;
  createdAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [examinerAssignments, setExaminerAssignments] = useState<ExaminerAssignmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [userData, dashboardData] = await Promise.all([
          api.get<{ status: string; data: { user: User } }>("/auth/me"),
          fetchDashboardStats(),
        ]);

        const user = userData.data.user;
        let assignments: ExaminerAssignmentSummary[] = [];
        if (user.role === "EXAMINER") {
          try {
            assignments = await fetchExaminerAssignments();
          } catch {
            // non-critical — dashboard still loads
          }
        } else if (user.role === "ADMIN") {
            router.push("/admin")
        }

        if (!cancelled) {
          setUser(user);
          setDashboard(dashboardData);
          setExaminerAssignments(assignments);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 401) {
          window.location.href = "/login";
          return;
        }
        setError("Failed to load your profile. Please try again.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Loading state
  if (loading) {
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
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="w-full max-w-sm">
          <Alert variant="destructive" className="items-start">
            <CircleAlertIcon />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button className="mt-4 w-full" size="lg" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const isExaminer = user?.role === "EXAMINER";

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
            isAdmin={user?.role === "ADMIN"}
          />
        }
      />

      <main id="dashboard-content" className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {isExaminer ? (
          <>
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
          </>
        ) : (
          <>
            <div className="max-w-2xl animate-rise">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
                Candidate dashboard
              </p>
              <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-ink sm:text-5xl">
                Welcome back{user?.name ? `, ${user.name}` : ""}.
              </h1>
              <p className="mt-3 text-[15px] leading-7 text-ink-soft">
                This is where your band reports land. Start a new assessment, or reopen a
                submission the jury has marked.
              </p>
            </div>

            {/* Stat cards */}
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <div className="border border-rule bg-paper-raised px-6 py-5">
                <p className="mark">Total tests</p>
                <p className="mt-2 font-mono text-4xl font-semibold tabular-nums text-ink">
                  {dashboard?.totalTests ?? 0}
                </p>
              </div>
              <div className="border border-rule bg-paper-raised px-6 py-5">
                <p className="mark">Best score</p>
                {dashboard?.bestScore != null ? (
                  <div className="mt-3">
                    <BandGauge band={dashboard.bestScore} size="md" />
                  </div>
                ) : (
                  <p className="mt-2 font-mono text-sm text-ink-faint">No score yet</p>
                )}
              </div>
            </div>

            {/* Start CTA — ink panel */}
            <div className="mt-6 flex flex-col gap-6 border border-ink bg-ink px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <div>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-paper/60">
                  Ready when you are
                </p>
                <h2 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-paper sm:text-3xl">
                  Record a new assessment
                </h2>
                <p className="mt-1.5 text-sm leading-6 text-paper/70">
                  About fifteen minutes. We check your camera and microphone before you
                  begin.
                </p>
              </div>
              <Button
                variant="invert"
                size="lg"
                className="shrink-0"
                onClick={() => setShowPermissionModal(true)}
              >
                Start your assessment
              </Button>
            </div>

            {/* Test history */}
            <section className="mt-12">
              <div>
                <p className="mark">Test history</p>
                <h2 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink">
                  Your reports
                </h2>
              </div>

              {dashboard && dashboard.submissions.length > 0 ? (
                <div className="mt-6 border border-rule bg-paper-raised">
                  <ul className="divide-y divide-rule" role="list">
                    {dashboard.submissions.map((sub) => (
                      <li key={sub.id}>
                        <Link
                          href={`/results/${sub.id}`}
                          className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-rule/40"
                        >
                          <div className="flex items-center gap-5">
                            <div>
                              <p className="font-mono text-sm tabular-nums text-ink">
                                {new Date(sub.createdAt).toLocaleDateString("en-US", {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </p>
                              <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                                {new Date(sub.createdAt).toLocaleTimeString("en-US", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                            {sub.score != null && (
                              <span className="border-l border-rule pl-4 font-mono text-lg font-semibold tabular-nums text-ink">
                                {sub.score}
                              </span>
                            )}
                          </div>
                          <span className="flex shrink-0 items-center gap-3">
                            <SubmissionStatus status={sub.status} />
                            <ChevronRightIcon
                              className="size-4 text-ink-faint transition-transform group-hover:translate-x-0.5"
                            />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-6 border border-dashed border-rule-strong bg-paper-raised px-6 py-14 text-center">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                    No assessments yet
                  </p>
                  <p className="mx-auto mt-4 max-w-sm font-display text-2xl font-medium tracking-tight text-ink">
                    Your band report will land here.
                  </p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-soft">
                    Record your first answers and two certified examiners will score your
                    pronunciation, fluency, vocabulary and grammar.
                  </p>
                  <Button
                    className="mt-7"
                    size="lg"
                    onClick={() => setShowPermissionModal(true)}
                  >
                    Start your assessment
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Camera & Mic confirmation — students only */}
      {!isExaminer && (
        <CameraMicPermissionModal
          open={showPermissionModal}
          onClose={() => setShowPermissionModal(false)}
          onComplete={() => {
            setShowPermissionModal(false);
            router.push("/test/demo-test");
          }}
        />
      )}
    </div>
  );
}
