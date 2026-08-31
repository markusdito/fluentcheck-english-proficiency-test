"use client";

import Link from "next/link";
import type { ExaminerAssignmentSummary } from "@/types/examiner";
import { SubmissionStatus } from "@/components/ui/submission-status";
import { ChevronRightIcon } from "lucide-react";

interface AssignmentListProps {
  assignments: ExaminerAssignmentSummary[];
}

export function AssignmentList({ assignments }: AssignmentListProps) {
  if (assignments.length === 0) {
    return (
      <div className="border border-dashed border-rule-strong bg-paper-raised px-6 py-12 text-center">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          No pending submissions
        </p>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-soft">
          Submissions assigned to you for scoring will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-rule bg-paper-raised">
      <ul className="divide-y divide-rule" role="list">
        {assignments.map((assignment) => (
          <li key={assignment.id}>
            <Link
              href={`/examiner/assignments/${assignment.id}`}
              className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-rule/40"
            >
              <div className="flex min-w-0 items-center gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center border border-rule bg-rule/30 font-display text-lg font-medium text-ink-soft">
                  {assignment.studentName.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {assignment.studentName}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {new Date(assignment.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <SubmissionStatus
                  status={assignment.status}
                />
                <ChevronRightIcon className="size-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
