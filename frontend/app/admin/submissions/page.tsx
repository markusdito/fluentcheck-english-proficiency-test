"use client";

import { testSetLabel } from "@/lib/assessment-slots";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import {
  fetchAdminSubmissions,
  assignExaminers,
} from "@/lib/admin-api";
import { StatusPill } from "@/components/student/StatusPill";
import { card, h2, meta, primaryButton, secondaryButton } from "@/components/student/styles";
import { chip, empty, lead, tableWrap, td, th, tr } from "@/components/admin/styles";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AdminSubmission, Paginated } from "@/types/admin";
import { queryKeys } from "@/lib/query-keys";
import { patchAssignedSubmissionPage } from "@/lib/admin-cache";

const SUBMISSION_STATUSES = [
  "AWAITING_PAYMENT",
  "PAID",
  "SCORING",
  "SCORED",
  "CERTIFIED",
] as const;

const LIMIT = 10;

/**
 * Approved actionable messages for the assignment failure classifications.
 * Capacity and contention are retryable; invariant corruption requires data
 * repair and must not be retried blindly.
 */
export function assignmentFailureMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Please try again.";
  switch (err.code) {
    case "INSUFFICIENT_CAPACITY":
      return "Two eligible examiners are required. Add or reactivate another examiner, then try again.";
    case "ASSIGNMENT_BUSY":
      return "Assignment is busy right now. Please try again in a moment.";
    case "INVARIANT_VIOLATION":
      return "Existing assignment data is invalid and requires data repair. Retrying will not fix it.";
    case "NOT_ASSIGNMENT_READY":
      return "This submission is not ready for assignment. Only paid or waived submissions can be assigned.";
    case "SUBMISSION_NOT_FOUND":
      return "This submission no longer exists.";
    default:
      return err.message || "Please try again.";
  }
}

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export default function AdminSubmissionsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const params = {
    page,
    limit: LIMIT,
    status: statusFilter || undefined,
  };
  const submissionsKey = queryKeys.adminSubmissions(params);
  const submissionsQuery = useQuery({
    queryKey: submissionsKey,
    queryFn: ({ signal }) => fetchAdminSubmissions(params, signal),
  });
  const items = submissionsQuery.data?.items ?? [];
  const totalPages = submissionsQuery.data?.totalPages ?? 1;

  async function handleAssign(submission: AdminSubmission) {
    setAssigningId(submission.id);
    try {
      const result = await assignExaminers(submission.id);
      queryClient.setQueryData<Paginated<AdminSubmission>>(
        submissionsKey,
        (current) => patchAssignedSubmissionPage(current, result),
      );
      const names = result.assignedExaminers.map((e) => e.name).join(", ");
      const headline =
        result.outcome === "EXISTING"
          ? "Examiners already assigned"
          : "Examiners assigned";
      toast.success(headline, {
        description: `Assigned: ${names}`,
      });
    } catch (err) {
      toast.error("Assignment failed", {
        description: assignmentFailureMessage(err),
      });
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <div>
      <h1 className={h2}>Submissions</h1>
      <p className={lead}>
        Review student submissions and assign two examiners to completed
        submissions that are paid or waived.
      </p>

      <div className="mt-10 mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter submissions">
        {[
          { value: "", label: "All" },
          ...SUBMISSION_STATUSES.map((status) => ({
            value: status,
            label: status.charAt(0) + status.slice(1).replace(/_/g, " ").toLowerCase(),
          })),
        ].map((opt) => (
          <button
            key={opt.value || "all"}
            type="button"
            onClick={() => {
              setStatusFilter(opt.value);
              setPage(1);
            }}
            aria-pressed={statusFilter === opt.value}
            className={chip(statusFilter === opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {submissionsQuery.isPending ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
        </div>
      ) : submissionsQuery.isError ? (
        <div className={`${card} text-center`}>
          <p className="text-[15px] text-sn-muted">Failed to load submissions. Please try again.</p>
          <button type="button" className={`${primaryButton} mt-5`} onClick={() => submissionsQuery.refetch()}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className={empty}>No submissions match the current filter.</p>
      ) : (
        <div className={tableWrap}>
          <table className="w-full border-collapse">
            <caption className="sr-only">Submissions</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>Candidate</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>Latest payment</th>
                <th scope="col" className={th}>Examiners</th>
                <th scope="col" className={th}><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((sub) => {
                // Assignment-ready covers paid and waived (payment not
                // required) submissions without an existing set.
                const canAssign =
                  (sub.status === "PAID" || !sub.paymentRequired) &&
                  sub.assignments.length === 0;
                return (
                  <tr key={sub.id} className={tr}>
                    <td className={td}>
                      <Link
                        href={`/admin/submissions/${sub.id}`}
                        aria-label={`View submission by ${sub.studentName}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {sub.studentName}
                      </Link>
                      <p className="mt-0.5 text-[13px] text-sn-muted">
                        {sub.studentEmail}
                        {sub.testSet && ` · ${testSetLabel(sub.testSet)}`}
                      </p>
                    </td>
                    <td className={td}><StatusPill status={sub.status} /></td>
                    <td className={td}>
                      {!sub.paymentRequired ? (
                        <StatusPill status="WAIVED" />
                      ) : sub.latestPayment?.status === "PAID" ? (
                        <span className="font-medium tabular-nums">{idr.format(sub.latestPayment.amount)}</span>
                      ) : (
                        <StatusPill status="PENDING" />
                      )}
                    </td>
                    <td className={td}>
                      {sub.assignments.length > 0 ? (
                        <ul className="grid min-w-[14rem] gap-1.5" role="list">
                          {sub.assignments.map((a) => (
                            <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                              <span className="min-w-0 truncate" title={a.examinerName}>{a.examinerName}</span>
                              <span className="shrink-0 text-[13px] text-sn-muted">
                                {a.status.charAt(0) + a.status.slice(1).replace(/_/g, " ").toLowerCase()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-sm text-sn-muted">Unassigned</span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      {canAssign ? (
                        <button
                          type="button"
                          className={`${secondaryButton} max-sm:w-auto`}
                          aria-busy={assigningId === sub.id || undefined}
                          disabled={assigningId !== null}
                          onClick={() => void handleAssign(sub)}
                        >
                          {assigningId === sub.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          Assign examiners
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {submissionsQuery.isSuccess && items.length > 0 && (
        <div className="mt-6 flex items-center justify-between gap-4">
          <p className={meta}>
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${secondaryButton} max-sm:w-auto`}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className={`${secondaryButton} max-sm:w-auto`}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
