"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Scissors, CircleAlertIcon } from "lucide-react";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { Header } from "@/components/layout/Header";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScaleAwareScoreDisplay } from "@/components/results/ScaleAwareScoreDisplay";
import { fetchDashboardStats, type DashboardStats } from "@/lib/dashboard-api";
import { fetchExaminerAssignments } from "@/lib/examiner-api";
import type { ExaminerAssignmentSummary } from "@/types/examiner";
import { fetchAdminStats } from "@/lib/admin-api";
import type { AdminStats } from "@/types/admin";

type Role = "STUDENT" | "EXAMINER" | "ADMIN";

interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

const roleLabels: Record<Role, { label: string; stamp: string }> = {
  STUDENT: { label: "Candidate", stamp: "stamp--ink" },
  EXAMINER: { label: "Examiner", stamp: "stamp--verified" },
  ADMIN: { label: "Administrator", stamp: "stamp--signal" },
};

const stubCopy: Record<Role, string> = {
  STUDENT:
    "Your candidate number on the FluentCheck record. Quote it in any correspondence with the jury.",
  EXAMINER:
    "Your examiner reference on the FluentCheck record. Quote it in any correspondence about your assignments.",
  ADMIN:
    "Your administrator reference on the FluentCheck record. Shown on audit entries you author.",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function candidateNumber(id: string) {
  return `FC-${id.slice(0, 8).toUpperCase()}`;
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [assignments, setAssignments] = useState<ExaminerAssignmentSummary[]>([]);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ status: string; data: { user: User } }>(
          "/auth/me"
        );
        const user = res.data.user;
        let dashboard: DashboardStats | null = null;
        let assignments: ExaminerAssignmentSummary[] = [];
        let adminStats: AdminStats | null = null;

        if (user.role === "EXAMINER") {
          try {
            assignments = await fetchExaminerAssignments();
          } catch {
            // non-critical — record still shows
          }
        } else if (user.role === "ADMIN") {
          try {
            adminStats = await fetchAdminStats();
          } catch {
            // non-critical — record still shows
          }
        } else {
          try {
            dashboard = await fetchDashboardStats();
          } catch {
            // non-critical — record still shows
          }
        }

        if (!cancelled) {
          setUser(user);
          setDashboard(dashboard);
          setAssignments(assignments);
          setAdminStats(adminStats);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && "statusCode" in err && (err as { statusCode: number }).statusCode === 401) {
          window.location.href = "/login";
          return;
        }
        setError("Failed to load your record. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
          <p className="text-sm text-ink-soft">Opening your record…</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
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

  const roleInfo = roleLabels[user.role];
  const toScore = assignments.filter(
    (a) => a.status === "ASSIGNED" || a.status === "IN_PROGRESS"
  ).length;
  const userCount = adminStats
    ? Object.values(adminStats.usersByRole).reduce((sum, n) => sum + n, 0)
    : 0;

  return (
    <div className="min-h-screen bg-paper">
      <a
        href="#profile-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to profile content
      </a>

      <Header
        logoHref="/dashboard"
        actions={<AccountMenu name={user.name} email={user.email} isAdmin={user.role === "ADMIN"} />}
      />

      <main id="profile-content" className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Heading */}
        <div className="animate-rise">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
            Profile · {roleInfo.label} record
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-display text-4xl font-medium tracking-tight text-ink sm:text-5xl">
              {user.name}
            </h1>
            <span className={`stamp ${roleInfo.stamp}`}>{roleInfo.label}</span>
          </div>
          <p className="mt-2 text-[15px] leading-7 text-ink-soft">
            Member since {formatDate(user.createdAt)}.
          </p>
        </div>

        {/* The record slip */}
        <section
          className="mt-10 border border-rule bg-paper-raised animate-rise"
          style={{ animationDelay: "80ms" }}
          aria-label="Your record"
        >
          {/* Sheet header strip */}
          <div className="flex items-center justify-between gap-4 border-b border-rule px-5 py-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              FluentCheck · Speaking assessment
            </p>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              No. {candidateNumber(user.id)}
            </p>
          </div>

          {/* Printed fields */}
          <dl className="divide-y divide-rule">
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center sm:gap-6">
              <dt className="mark">Name</dt>
              <dd className="font-mono text-[15px] text-ink">{user.name}</dd>
            </div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center sm:gap-6">
              <dt className="mark">Email</dt>
              <dd className="truncate font-mono text-[15px] text-ink">{user.email}</dd>
            </div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center sm:gap-6">
              <dt className="mark">Role</dt>
              <dd>
                <span className={`stamp ${roleInfo.stamp}`}>{roleInfo.label}</span>
              </dd>
            </div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center sm:gap-6">
              <dt className="mark">Member since</dt>
              <dd className="font-mono text-[15px] tabular-nums text-ink">
                {formatDate(user.createdAt)}
              </dd>
            </div>
          </dl>

          {/* Tear-off stub */}
          <div className="relative border-t border-dashed border-rule-strong">
            <span className="absolute -top-2.5 left-6 flex size-5 items-center justify-center bg-paper-raised">
              <Scissors className="size-3.5 text-ink-faint" aria-hidden="true" />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4 sm:px-6">
              <div>
                <p className="mark">Keep this portion</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink">
                  {candidateNumber(user.id)}
                </p>
              </div>
              <p className="max-w-56 text-xs leading-5 text-ink-faint">
                {stubCopy[user.role]}
              </p>
            </div>
          </div>
        </section>

        {/* At a glance */}
        {user.role === "STUDENT" && dashboard && (
          <section className="mt-10" aria-label="Your record at a glance">
            <p className="mark">At a glance</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="border border-rule bg-paper-raised px-6 py-5">
                <p className="mark">Tests taken</p>
                <p className="mt-2 font-mono text-4xl font-semibold tabular-nums text-ink">
                  {dashboard.totalTests}
                </p>
              </div>
              <div className="border border-rule bg-paper-raised px-6 py-5">
                <p className="mark">Best band</p>
                {dashboard.bestScore != null ? (
                  <div className="mt-3">
                    <ScaleAwareScoreDisplay score={dashboard.bestScore} />
                  </div>
                ) : (
                  <p className="mt-2 font-mono text-sm text-ink-faint">No score yet</p>
                )}
              </div>
            </div>
          </section>
        )}

        {user.role === "EXAMINER" && (
          <section className="mt-10" aria-label="Your work at a glance">
            <p className="mark">At a glance</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="border border-rule bg-paper-raised px-6 py-5">
                <p className="mark">Assigned submissions</p>
                <p className="mt-2 font-mono text-4xl font-semibold tabular-nums text-ink">
                  {assignments.length}
                </p>
              </div>
              <div className="border border-rule bg-paper-raised px-6 py-5">
                <p className="mark">To score</p>
                <p className="mt-2 font-mono text-4xl font-semibold tabular-nums text-ink">
                  {toScore}
                </p>
              </div>
            </div>
          </section>
        )}

        {user.role === "ADMIN" && adminStats && (
          <section className="mt-10" aria-label="Platform at a glance">
            <p className="mark">Platform at a glance</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="border border-rule bg-paper-raised px-6 py-5">
                <p className="mark">Users</p>
                <p className="mt-2 font-mono text-4xl font-semibold tabular-nums text-ink">
                  {userCount}
                </p>
              </div>
              <div className="border border-rule bg-paper-raised px-6 py-5">
                <p className="mark">Pending grading</p>
                <p className="mt-2 font-mono text-4xl font-semibold tabular-nums text-ink">
                  {adminStats.pendingGrading}
                </p>
              </div>
              <div className="border border-rule bg-paper-raised px-6 py-5">
                <p className="mark">Paid revenue</p>
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-ink">
                  IDR {adminStats.paidRevenue.toLocaleString("id-ID")}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Account actions */}
        <section className="mt-10 border border-rule bg-paper-raised" aria-label="Account actions">
          <div className="flex items-center justify-between gap-4 border-b border-rule px-5 py-4">
            <div>
              <p className="text-sm font-medium text-ink">
                {user.role === "ADMIN" ? "Open the admin panel" : "Back to your work"}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {user.role === "ADMIN"
                  ? "The admin panel holds users, submissions and questions."
                  : user.role === "EXAMINER"
                    ? "Assigned submissions are listed on your dashboard."
                    : "Reports and new assessments live on your dashboard."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={user.role === "ADMIN" ? "/admin" : "/dashboard"} />}
            >
              {user.role === "ADMIN" ? "Admin panel" : "Dashboard"}
            </Button>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-ink">Sign out</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                Ends this session on this device. You can sign back in anytime.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
