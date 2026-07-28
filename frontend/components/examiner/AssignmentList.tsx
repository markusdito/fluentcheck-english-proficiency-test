"use client";

import Link from "next/link";
import type { ExaminerAssignmentSummary } from "@/types/examiner";

const statusBadge: Record<string, { bg: string; text: string; label: string }> = {
  ASSIGNED: { bg: "bg-amber-50", text: "text-amber-700", label: "Assigned" },
  IN_PROGRESS: { bg: "bg-blue-50", text: "text-blue-700", label: "In Progress" },
  COMPLETED: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Completed" },
};

const submissionStatusBadge: Record<string, { bg: string; text: string }> = {
  SCORING: { bg: "bg-purple-50", text: "text-purple-700" },
  PAID: { bg: "bg-blue-50", text: "text-blue-700" },
  SCORED: { bg: "bg-emerald-50", text: "text-emerald-700" },
};

interface AssignmentListProps {
  assignments: ExaminerAssignmentSummary[];
}

export function AssignmentList({ assignments }: AssignmentListProps) {
  if (assignments.length === 0) {
    return (
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
        <h3 className="mt-4 text-base font-medium text-[var(--foreground)]">No pending submissions</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Submissions assigned to you for scoring will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm">
      <ul className="divide-y divide-[var(--border)]" role="list">
        {assignments.map((assignment) => {
          const badge = statusBadge[assignment.status] ?? statusBadge.ASSIGNED;
          const subBadge = submissionStatusBadge[assignment.submissionStatus];
          return (
            <li key={assignment.id}>
              <Link
                href={`/examiner/assignments/${assignment.id}`}
                className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-zinc-50"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100">
                    <span className="text-sm font-semibold text-[var(--muted)]">
                      {assignment.studentName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {assignment.studentName}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {new Date(assignment.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {subBadge && (
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${subBadge.bg} ${subBadge.text}`}>
                      {assignment.submissionStatus.replace(/_/g, " ")}
                    </span>
                  )}
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </span>
                  <svg className="h-5 w-5 text-[var(--muted)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                  </svg>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
