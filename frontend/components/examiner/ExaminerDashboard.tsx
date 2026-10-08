"use client";

import { useState } from "react";
import Link from "next/link";
import type { ExaminerAssignmentSummary } from "@/types/examiner";
import { PageShell } from "@/components/student/PageShell";
import { Pill } from "@/components/student/StatusPill";
import { card, focusRing, h2, meta, secondaryButton, statNum } from "@/components/student/styles";
import { cn } from "@/lib/cn";

type Filter = "all" | "open" | "progress" | "done";

const FILTERS: Array<[Filter, string]> = [
  ["all", "All"],
  ["open", "To score"],
  ["progress", "In progress"],
  ["done", "Completed by me"],
];

const matches: Record<Filter, (a: ExaminerAssignmentSummary) => boolean> = {
  all: () => true,
  open: (a) => a.status === "ASSIGNED",
  progress: (a) => a.status === "IN_PROGRESS",
  done: (a) => a.status === "COMPLETED",
};

const isFinal = (a: ExaminerAssignmentSummary) =>
  a.submissionStatus === "SCORED" || a.submissionStatus === "CERTIFIED";

export const submissionRef = (id: string) => `SN-${id.slice(0, 8).toUpperCase()}`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export function AssignmentPill({ a }: { a: Pick<ExaminerAssignmentSummary, "status" | "submissionStatus"> }) {
  if (a.status === "ASSIGNED") return <Pill tone="navy">To score</Pill>;
  if (a.status === "IN_PROGRESS") return <Pill tone="amber">In progress</Pill>;
  if (a.submissionStatus === "CERTIFIED") return <Pill tone="green">Certified</Pill>;
  if (a.submissionStatus === "SCORED") return <Pill tone="green">Scored</Pill>;
  return <Pill tone="green">Scored by me</Pill>;
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-sn-border bg-sn-surface p-5">
      <p className="m-0 text-sm text-sn-muted">{label}</p>
      <p className={`${statNum} mt-3 text-[32px]`}>{value}</p>
    </div>
  );
}

const chip = `min-h-11 cursor-pointer rounded-full border px-4 text-sm transition-colors duration-200 ${focusRing}`;
const th = "border-b border-sn-border px-3 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.05em] text-sn-muted";
const td = "border-b border-sn-border px-3 py-3.5 align-middle text-[15px]";

interface ExaminerDashboardProps {
  name: string;
  email: string;
  assignments: ExaminerAssignmentSummary[];
}

export function ExaminerDashboard({ name, email, assignments }: ExaminerDashboardProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = assignments.filter(matches[filter]);
  const count = (f: Filter) => assignments.filter(matches[f]).length;
  const awaitingPair = assignments.filter((a) => a.status === "COMPLETED" && !isFinal(a)).length;
  const first = name.trim().split(/\s+/)[0];

  return (
    <PageShell name={name} email={email} label="Examiner" contentId="dashboard-content" skipLabel="Skip to dashboard content">
      <div className="max-w-[60ch]">
        <h1 className={h2}>Examiner workspace</h1>
        <p className="mt-3 text-[15px] text-sn-muted">
          Welcome back{first ? `, ${first}` : ""}. Score each assigned submission against the shared rubric. The
          final band is the mean of two independent examiners.
        </p>
      </div>

      <section aria-label="Queue summary" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile value={count("open") + count("progress")} label="In my queue" />
        <Tile value={count("progress")} label="Scoring in progress" />
        <Tile value={count("done")} label="Completed by me" />
        <Tile value={awaitingPair} label="Awaiting second examiner" />
      </section>

      <section aria-labelledby="queue-title" className="mt-14">
        <h2 id="queue-title" className="sr-only">Assigned submissions</h2>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter queue">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  chip,
                  filter === value
                    ? "border-sn-fg bg-sn-fg text-sn-surface"
                    : "border-sn-border bg-sn-surface text-sn-muted hover:border-sn-fg/32 hover:text-sn-fg",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className={meta}>
            {assignments.length} submission{assignments.length === 1 ? "" : "s"}
          </p>
        </div>

        {rows.length ? (
          <div className="overflow-x-auto rounded-2xl border border-sn-border bg-sn-surface">
            <table className="w-full border-collapse">
              <caption className="sr-only">Assigned submissions</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Submission</th>
                  <th scope="col" className={th}>Candidate</th>
                  <th scope="col" className={th}>Assigned</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="transition-colors hover:bg-sn-bg [&:last-child>td]:border-b-0">
                    <td className={`${td} font-medium whitespace-nowrap tabular-nums`}>{submissionRef(a.submissionId)}</td>
                    <td className={`${td} max-w-[24ch] truncate`}>{a.studentName}</td>
                    <td className={`${td} whitespace-nowrap tabular-nums text-sn-muted`}>{formatDate(a.createdAt)}</td>
                    <td className={td}><AssignmentPill a={a} /></td>
                    <td className={`${td} text-right`}>
                      <Link
                        href={`/examiner/assignments/${a.id}`}
                        className={`${secondaryButton} max-sm:w-auto`}
                        aria-label={`${a.status === "COMPLETED" ? "View" : "Open"} ${submissionRef(a.submissionId)}`}
                      >
                        {a.status === "COMPLETED" ? "View" : "Open"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={`${card} text-center`}>
            <p className="text-[15px] text-sn-muted">
              {assignments.length
                ? "No submissions match this filter."
                : "No submissions assigned yet. New assignments appear here once a paid submission is ready for scoring."}
            </p>
          </div>
        )}
      </section>
    </PageShell>
  );
}
