"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import {
  fetchAdminSubmissions,
  assignExaminers,
} from "@/lib/admin-api";
import { SubmissionStatus } from "@/components/ui/submission-status";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AdminSubmission } from "@/types/admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const SUBMISSION_STATUSES = [
  "AWAITING_PAYMENT",
  "PAID",
  "SCORING",
  "SCORED",
  "CERTIFIED",
] as const;

const LIMIT = 10;

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export default function AdminSubmissionsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [items, setItems] = useState<AdminSubmission[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);

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
      toast.success("Examiners assigned", {
        description: `Assigned: ${names}`,
      });
    } catch (err) {
      toast.error("Assignment failed", {
        description:
          err instanceof ApiError ? err.message : "Please try again.",
      });
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="mark">Queue</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
          Submissions
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          Review student submissions and assign examiners to paid tests.
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        {[
          { value: "", label: "All" },
          ...SUBMISSION_STATUSES.map((status) => ({
            value: status,
            label: status.replace(/_/g, " "),
          })),
        ].map((opt) => {
          const active = statusFilter === opt.value;
          return (
            <button
              key={opt.value || "all"}
              type="button"
              onClick={() => {
                setStatusFilter(opt.value);
                setPage(1);
              }}
              aria-pressed={active}
              className={cn(
                "border-b-2 pb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors",
                active
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
        </div>
      ) : error ? (
        <div className="flex h-64 items-center justify-center">
          <p className="text-sm text-ink-soft">{error}</p>
          <Button className="ml-4" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-rule-strong bg-paper-raised px-6 py-12 text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            No submissions
          </p>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-soft">
            No submissions match the current filter.
          </p>
        </div>
      ) : (
        <div className="border border-rule bg-paper-raised">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="mark px-5 text-center text-xs font-semibold">Student</TableHead>
                <TableHead className="mark px-5 text-center text-xs font-semibold">Status</TableHead>
                <TableHead className="mark px-5 text-center text-xs font-semibold">Latest payment</TableHead>
                <TableHead className="mark px-5 text-center text-xs font-semibold">Assignments</TableHead>
                <TableHead className="mark px-5 text-center text-xs font-semibold">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((sub) => {
                const canAssign =
                  sub.status === "PAID" && sub.assignments.length === 0;
                return (
                  <TableRow
                    key={sub.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`View submission by ${sub.studentName}`}
                    className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink [&>td]:align-middle"
                    onClick={(event) => {
                      const target = event.target as HTMLElement;
                      if (
                        target.closest(
                          "button, a, input, select, textarea, [role='button']"
                        )
                      ) {
                        return;
                      }
                      router.push(`/admin/submissions/${sub.id}`);
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter") {
                        event.preventDefault();
                        router.push(`/admin/submissions/${sub.id}`);
                      }
                    }}
                  >
                    <TableCell className="px-5 py-3.5">
                      <p className="font-medium text-ink">{sub.studentName}</p>
                      <p className="mt-0.5 text-xs text-ink-soft">{sub.studentEmail}</p>
                    </TableCell>
                    <TableCell className="px-5 py-3.5 text-center">
                      <SubmissionStatus status={sub.status} />
                    </TableCell>
                    <TableCell className="px-5 py-3.5 text-center">
                      {!sub.paymentRequired ? (
                        <SubmissionStatus status="WAIVED" />
                      ) : sub.latestPayment?.status === "PAID" ? (
                        <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                          {idr.format(sub.latestPayment.amount)}
                        </span>
                      ) : (
                        <SubmissionStatus status="PENDING" />
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      {sub.assignments.length > 0 ? (
                        <div className="flex min-w-[17rem] flex-col divide-y divide-rule">
                          {sub.assignments.map((a) => (
                            <div
                              key={a.id}
                              className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 py-2 first:pt-0 last:pb-0"
                            >
                              <span
                                className="min-w-0 truncate text-xs font-medium text-ink"
                                title={a.examinerName}
                              >
                                {a.examinerName}
                              </span>
                              <SubmissionStatus status={a.status} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-faint">None</span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-3.5 text-right">
                      {canAssign ? (
                        <Button
                          size="sm"
                          loading={assigningId === sub.id}
                          disabled={assigningId !== null && assigningId !== sub.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleAssign(sub);
                          }}
                        >
                          Assign examiners
                        </Button>
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && items.length > 0 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-ink-soft">
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
