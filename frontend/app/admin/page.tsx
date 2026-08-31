"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminStats } from "@/lib/admin-api";
import { fetchExaminerAssignments } from "@/lib/examiner-api";
import { AssignmentList } from "@/components/examiner/AssignmentList";
import { queryKeys } from "@/lib/query-keys";
import { SubmissionStatus } from "@/components/ui/submission-status";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

function StatCard({
  eyebrow,
  value,
  children,
}: {
  eyebrow: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border border-rule bg-paper-raised px-6 py-5">
      <p className="mark">{eyebrow}</p>
      {value != null ? (
        <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">
          {value}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export default function AdminOverviewPage() {
  const statsQuery = useQuery({
    queryKey: queryKeys.adminStats,
    queryFn: ({ signal }) => fetchAdminStats(signal),
  });
  const assignmentsQuery = useQuery({
    queryKey: queryKeys.examinerAssignments,
    queryFn: ({ signal }) => fetchExaminerAssignments(signal),
  });
  const stats = statsQuery.data;

  if (statsQuery.isPending) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (statsQuery.isError) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-ink-soft">
          Failed to load admin stats. Please try again.
        </p>
        <Button className="ml-4" onClick={() => statsQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const revenue = (stats?.paidRevenue ?? 0).toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });

  return (
    <div>
      <div className="mb-8">
        <p className="mark">Platform overview</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
          Overview
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          A summary of platform activity.
        </p>
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <StatCard eyebrow="Users by role">
          <div className="mt-3 space-y-1">
            {Object.entries(stats?.usersByRole ?? {}).map(([role, count]) => (
              <div
                key={role}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-ink">{role}</span>
                <span className="font-mono font-semibold tabular-nums text-ink">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </StatCard>
        <StatCard eyebrow="Submissions by status">
          <div className="mt-3 space-y-1">
            {Object.entries(stats?.submissionsByStatus ?? {}).map(
              ([status, count]) => (
                <div
                  key={status}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-ink">{status.replace(/_/g, " ")}</span>
                  <span className="font-mono font-semibold tabular-nums text-ink">
                    {count}
                  </span>
                </div>
              ),
            )}
          </div>
        </StatCard>
        <StatCard eyebrow="Paid revenue" value={revenue} />
        <StatCard eyebrow="Pending grading" value={String(stats?.pendingGrading ?? 0)} />
      </div>

      <section className="mb-10" aria-label="Your examiner work">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="mark">Your examiner work</p>
            <h2 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink">
              Existing assignments
            </h2>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-ink underline-offset-4 hover:underline"
          >
            Open work view
          </Link>
        </div>
        {assignmentsQuery.isPending ? (
          <div className="flex h-28 items-center justify-center border border-rule bg-paper-raised">
            <Loader2 className="size-6 animate-spin text-ink-faint" role="status" aria-label="Loading assignments" />
          </div>
        ) : assignmentsQuery.isError ? (
          <div className="border border-dashed border-rule-strong bg-paper-raised px-6 py-8 text-center">
            <p className="text-sm text-ink-soft">
              Existing examiner assignments could not be loaded. Refresh to try again.
            </p>
          </div>
        ) : (
          <AssignmentList assignments={assignmentsQuery.data ?? []} />
        )}
      </section>

      {/* Recent submissions */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="mark">Latest activity</p>
            <h2 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink">
              Recent submissions
            </h2>
          </div>
          <Link
            href="/admin/submissions"
            className="text-sm font-medium text-ink underline-offset-4 hover:underline"
          >
            View all
          </Link>
        </div>
        {stats && stats.recentSubmissions.length > 0 ? (
          <div className="border border-rule bg-paper-raised">
            <ul className="divide-y divide-rule" role="list">
              {stats.recentSubmissions.map((sub) => (
                <li key={sub.id}>
                  <Link
                    href={`/admin/submissions/${sub.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-rule/40"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <SubmissionStatus status={sub.status} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {sub.studentName ?? "—"}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-soft">
                          {new Date(sub.createdAt).toLocaleString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-ink-faint">
                      {sub.id.slice(0, 8)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="border border-dashed border-rule-strong bg-paper-raised px-6 py-12 text-center">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              No submissions yet
            </p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-soft">
              Submissions will appear here once students complete a test.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
