"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  fetchAdminSubmissions,
  assignExaminers,
} from "@/lib/admin-api";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { AdminSubmission } from "@/types/admin";

const SUBMISSION_STATUSES = [
  "IN_PROGRESS",
  "AWAITING_PAYMENT",
  "PAID",
  "SCORING",
  "SCORED",
  "CERTIFIED",
] as const;

type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

const submissionTone: Record<SubmissionStatus, "amber" | "blue" | "emerald" | "zinc"> = {
  IN_PROGRESS: "zinc",
  AWAITING_PAYMENT: "amber",
  PAID: "blue",
  SCORING: "blue",
  SCORED: "emerald",
  CERTIFIED: "emerald",
};

const paymentTone: Record<string, "amber" | "blue" | "emerald" | "zinc"> = {
  PENDING: "amber",
  PAID: "emerald",
  FAILED: "zinc",
  REFUNDED: "zinc",
};

const assignmentTone: Record<string, "amber" | "blue" | "emerald" | "zinc"> = {
  ASSIGNED: "amber",
  IN_PROGRESS: "blue",
  COMPLETED: "emerald",
};

const LIMIT = 10;

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export default function AdminSubmissionsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [items, setItems] = useState<AdminSubmission[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState("");
  const [actionMsgTone, setActionMsgTone] = useState<"success" | "error">("success");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAdminSubmissions({
          page,
          limit: LIMIT,
          status: statusFilter || undefined,
        });
        if (!cancelled) {
          setItems(data.items);
          setTotalPages(data.totalPages);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 401) {
          window.location.href = "/login";
          return;
        }
        setError("Failed to load submissions. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, statusFilter]);

  async function handleAssign(submission: AdminSubmission) {
    setAssigningId(submission.id);
    setActionMsg("");
    try {
      await assignExaminers(submission.id);
      const data = await fetchAdminSubmissions({
        page,
        limit: LIMIT,
        status: statusFilter || undefined,
      });
      setItems(data.items);
      setTotalPages(data.totalPages);
      const updated = data.items.find((s) => s.id === submission.id);
      const names = updated?.assignments.map((a) => a.examinerName).join(", ") ?? "";
      setActionMsgTone("success");
      setActionMsg(`Assigned: ${names}`);
    } catch (err) {
      setActionMsgTone("error");
      if (err instanceof ApiError) {
        setActionMsg(err.message);
      } else {
        setActionMsg("Failed to assign examiners. Please try again.");
      }
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
          Submissions
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Review student submissions and assign examiners to paid tests.
        </p>
      </div>

      {actionMsg && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            actionMsgTone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
          role={actionMsgTone === "error" ? "alert" : "status"}
        >
          {actionMsg}
        </div>
      )}

      {/* Status filter chips */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setStatusFilter("");
            setPage(1);
          }}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            statusFilter === ""
              ? "bg-[var(--primary)] text-white"
              : "border border-[var(--border)] bg-white text-[var(--muted)] hover:bg-zinc-50"
          }`}
        >
          All
        </button>
        {SUBMISSION_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => {
              setStatusFilter(status);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === status
                ? "bg-[var(--primary)] text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)] hover:bg-zinc-50"
            }`}
          >
            {status.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-ink-faint" />
        </div>
      ) : error ? (
        <div className="flex h-64 items-center justify-center">
          <div className="max-w-sm rounded-xl border border-[var(--border)] bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-[var(--muted)]">{error}</p>
            <Button
              variant="default"
              className="mt-4"
              onClick={() => window.location.reload()}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100">
            <svg className="h-6 w-6 text-[var(--muted)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4 1a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V4.414A1 1 0 0016.707 3.95l-2.657-2.657A1 1 0 0013.586 1H4zm7 1v4a1 1 0 01-1 1H6a1 1 0 01-1-1V2H4v16h12V2h-1v4a1 1 0 01-1 1H9a1 1 0 01-1-1V2H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-medium text-[var(--foreground)]">No submissions</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            No submissions match the current filter.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-zinc-50">
                <th className="px-6 py-3 font-medium text-[var(--muted)]">Student</th>
                <th className="px-6 py-3 font-medium text-[var(--muted)]">Status</th>
                <th className="px-6 py-3 font-medium text-[var(--muted)]">Latest Payment</th>
                <th className="px-6 py-3 font-medium text-[var(--muted)]">Assignments</th>
                <th className="px-6 py-3 text-right font-medium text-[var(--muted)]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((sub) => {
                const canAssign =
                  sub.status === "PAID" && sub.assignments.length === 0;
                return (
                  <tr key={sub.id} className="align-top">
                    <td className="px-6 py-4">
                      <p className="font-medium text-[var(--foreground)]">{sub.studentName}</p>
                      <p className="text-xs text-[var(--muted)]">{sub.studentEmail}</p>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge
                        label={sub.status.replace(/_/g, " ")}
                        tone={submissionTone[sub.status as SubmissionStatus] ?? "zinc"}
                      />
                    </td>
                    <td className="px-6 py-4">
                      {sub.latestPayment ? (
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge
                            label={sub.latestPayment.status}
                            tone={paymentTone[sub.latestPayment.status] ?? "zinc"}
                          />
                          <span className="text-xs text-[var(--muted)]">
                            {idr.format(sub.latestPayment.amount)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {sub.assignments.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {sub.assignments.map((a) => (
                            <StatusBadge
                              key={a.id}
                              label={`${a.examinerName} · ${a.status.replace(/_/g, " ")}`}
                              tone={assignmentTone[a.status] ?? "zinc"}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">None</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {canAssign ? (
                        <Button
                          size="sm"
                          loading={assigningId === sub.id}
                          disabled={assigningId !== null && assigningId !== sub.id}
                          onClick={() => handleAssign(sub)}
                        >
                          Assign examiners
                        </Button>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && items.length > 0 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-[var(--muted)]">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
