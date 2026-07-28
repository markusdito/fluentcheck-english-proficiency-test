"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { fetchDashboardStats, type DashboardStats } from "@/lib/dashboard-api";
import { fetchExaminerAssignments } from "@/lib/examiner-api";
import { AssignmentList } from "@/components/examiner/AssignmentList";
import { CameraMicPermissionModal } from "@/components/hardware/CameraMicPermissionModal";
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
        const token =
          typeof window !== "undefined"
            ? localStorage.getItem("token")
            : null;
        if (!token) {
          window.location.href = "/login";
          return;
        }
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
        }

        if (!cancelled) {
          setUser(user);
          setDashboard(dashboardData);
          setExaminerAssignments(assignments);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 401) {
          localStorage.removeItem("token");
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

  // Loading skeleton
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-(--border) border-t-[var(--primary)]"
            role="status"
            aria-label="Loading"
          />
          <p className="text-sm text-[var(--muted)]">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="max-w-sm rounded-xl border border-[var(--border)] bg-white p-8 text-center shadow-lg">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg className="h-6 w-6 text-[var(--danger)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.94 7.94a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM8 10a.75.75 0 01.75-.75h.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-2.75H8.75A.75.75 0 018 10z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-[var(--foreground)]">
            Something went wrong
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-5 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-dark)]"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const isExaminer = user?.role === "EXAMINER";

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Skip link */}
      <a
        href="#dashboard-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[var(--primary)] focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to dashboard content
      </a>

      {/* Top navigation bar */}
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--foreground)]"
          >
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-white ${isExaminer ? "bg-emerald-600" : "bg-[var(--primary)]"}`}>
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2a3 3 0 00-3 3v1H7a3 3 0 00-3 3v1a3 3 0 000 6v1a3 3 0 003 3h2v1a3 3 0 006 0v-1h2a3 3 0 003-3v-1a3 3 0 000-6v-1a3 3 0 00-3-3h-2V5a3 3 0 00-3-3z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </span>
            FluentCheck
          </Link>

          {isExaminer && (
            <span className="rounded-md bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              Examiner
            </span>
          )}

          <div className="flex items-center gap-4">
            <span className="hidden text-sm font-medium text-[var(--muted)] sm:block">
              {user?.name}
            </span>
            <button
              onClick={() => {
                localStorage.removeItem("token");
                window.location.href = "/";
              }}
              className="text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--danger)]"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main id="dashboard-content" className="mx-auto max-w-6xl px-6 py-8 sm:py-12">
        {isExaminer ? (
          <>
            {/* Examiner welcome heading */}
            <div className="mb-8 sm:mb-10">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
                Examiner Dashboard
              </h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Welcome back{user?.name ? `, ${user.name}` : ""}. Review and score assigned submissions.
              </p>
            </div>

            {/* Assigned Submissions */}
            <section>
              <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">
                Assigned Submissions
              </h2>
              <AssignmentList assignments={examinerAssignments} />
            </section>
          </>
        ) : (
          <>
            {/* Student welcome heading */}
            <div className="mb-8 sm:mb-10">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
                Welcome back{user?.name ? `, ${user.name}` : ""}
              </h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Here's a summary of your assessment progress.
              </p>
            </div>

            {/* Stats cards */}
            <div className="mb-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
                <p className="text-sm font-medium text-[var(--muted)]">Total Tests</p>
                <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                  {dashboard?.totalTests ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
                <p className="text-sm font-medium text-[var(--muted)]">Average Score</p>
                <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                  {dashboard?.averageScore != null ? dashboard.averageScore : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
                <p className="text-sm font-medium text-[var(--muted)]">Best Score</p>
                <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                  {dashboard?.bestScore != null ? dashboard.bestScore : "—"}
                </p>
              </div>
            </div>

            {/* Start New Test CTA */}
            <div className="mb-10 rounded-xl border border-[var(--border)] bg-gradient-to-br from-[var(--primary)] via-blue-700 to-indigo-800 p-8 text-white shadow-lg">
              <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold">Ready for a new challenge?</h2>
                  <p className="mt-1 text-sm text-blue-100">
                    Start a new speaking assessment and get expert feedback.
                  </p>
                </div>
                <button
                  onClick={() => setShowPermissionModal(true)}
                  className="inline-flex h-12 shrink-0 items-center justify-center rounded-lg bg-white px-8 text-sm font-medium text-[var(--primary)] shadow-sm transition-colors hover:bg-blue-50"
                >
                  Start New Test
                </button>
              </div>
            </div>

            {/* Test History */}
            <section>
              <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">
                Test History
              </h2>
              {dashboard && dashboard.submissions.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm">
                  <ul className="divide-y divide-[var(--border)]" role="list">
                    {dashboard.submissions.map((sub) => (
                      <li key={sub.id}>
                        <Link
                          href={`/results/${sub.id}`}
                          className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-zinc-50"
                        >
                          <div className="flex items-center gap-4">
                            <div>
                              <p className="text-sm font-medium text-[var(--foreground)]">
                                {new Date(sub.createdAt).toLocaleDateString("en-US", {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </p>
                              <p className="text-xs text-[var(--muted)]">
                                {new Date(sub.createdAt).toLocaleTimeString("en-US", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {sub.score != null && (
                              <span className="text-sm font-semibold text-[var(--foreground)]">
                                {sub.score}
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                sub.status === "CERTIFIED"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : sub.status === "SCORED"
                                    ? "bg-blue-50 text-blue-700"
                                    : sub.status === "IN_PROGRESS"
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-zinc-100 text-zinc-600"
                              }`}
                            >
                              {sub.status.replace(/_/g, " ")}
                            </span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100">
                    <svg className="h-7 w-7 text-[var(--muted)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M4 1a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V4.414A1 1 0 0016.707 3.95l-2.657-2.657A1 1 0 0013.586 1H4zm7 1v4a1 1 0 01-1 1H6a1 1 0 01-1-1V2H4v16h12V2h-1v4a1 1 0 01-1 1H9a1 1 0 01-1-1V2H9z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-base font-medium text-[var(--foreground)]">
                    No tests yet
                  </h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Start your first assessment to see your history here.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Camera & Mic Permission Modal — only for students */}
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
