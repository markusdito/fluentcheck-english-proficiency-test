"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { fetchAdminStats } from "@/lib/admin-api";
import type { AdminStats } from "@/types/admin";
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
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAdminStats();
        if (!cancelled) {
          setStats(data);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 401) {
          window.location.href = "/login";
          return;
        }
        setError("Failed to load admin stats. Please try again.");
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

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-ink-soft">{error}</p>
        <Button className="ml-4" onClick={() => window.location.reload()}>
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
                    href="/admin/submissions"
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
              Submissions will appear here once students start a test.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
