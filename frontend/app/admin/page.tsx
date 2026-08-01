"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { fetchAdminStats } from "@/lib/admin-api";
import type { AdminStats } from "@/types/admin";
import { StatusBadge } from "@/components/admin/StatusBadge";

const statusTone: Record<string, "amber" | "blue" | "emerald" | "zinc"> = {
  IN_PROGRESS: "amber",
  SCORED: "blue",
  CERTIFIED: "emerald",
};

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
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-(--border) border-t-[var(--primary)]"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="max-w-sm rounded-xl border border-[var(--border)] bg-white p-8 text-center shadow-lg">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
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

  const revenue = (stats?.paidRevenue ?? 0).toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
          Overview
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          A summary of platform activity.
        </p>
      </div>

      {/* Stats cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-[var(--muted)]">Users by role</p>
          <div className="mt-3 space-y-1">
            {Object.entries(stats?.usersByRole ?? {}).map(([role, count]) => (
              <div
                key={role}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-[var(--foreground)]">{role}</span>
                <span className="font-semibold text-[var(--foreground)]">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-[var(--muted)]">
            Submissions by status
          </p>
          <div className="mt-3 space-y-1">
            {Object.entries(stats?.submissionsByStatus ?? {}).map(
              ([status, count]) => (
                <div
                  key={status}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-[var(--foreground)]">
                    {status.replace(/_/g, " ")}
                  </span>
                  <span className="font-semibold text-[var(--foreground)]">
                    {count}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-[var(--muted)]">Paid revenue</p>
          <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">
            {revenue}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-[var(--muted)]">
            Pending grading
          </p>
          <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">
            {stats?.pendingGrading ?? 0}
          </p>
        </div>
      </div>

      {/* Recent submissions */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Recent submissions
          </h2>
          <Link
            href="/admin/submissions"
            className="text-sm font-medium text-[var(--primary)] transition-colors hover:text-[var(--primary-dark)]"
          >
            View all
          </Link>
        </div>
        {stats && stats.recentSubmissions.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm">
            <ul className="divide-y divide-[var(--border)]" role="list">
              {stats.recentSubmissions.map((sub) => (
                <li key={sub.id}>
                  <Link
                    href="/admin/submissions"
                    className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-zinc-50"
                  >
                    <div className="flex items-center gap-4">
                      <StatusBadge
                        label={sub.status.replace(/_/g, " ")}
                        tone={statusTone[sub.status] ?? "zinc"}
                      />
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          {sub.studentName ?? "—"}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
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
                    <span className="text-xs text-[var(--muted)]">
                      {sub.id.slice(0, 8)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
            <h3 className="text-base font-medium text-[var(--foreground)]">
              No submissions yet
            </h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Submissions will appear here once students start a test.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
