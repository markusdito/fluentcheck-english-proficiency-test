"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { fetchAdminStats } from "@/lib/admin-api";
import { fetchExaminerAssignments } from "@/lib/examiner-api";
import { AssignmentList } from "@/components/examiner/AssignmentList";
import { queryKeys } from "@/lib/query-keys";
import { StatusPill } from "@/components/student/StatusPill";
import { card, h2, h3, meta, primaryButton, secondaryButton, statNum } from "@/components/student/styles";
import { empty, lead, tableWrap, td, th, tr } from "@/components/admin/styles";
import { submissionRef } from "@/components/examiner/ExaminerDashboard";

const FLOW = ["IN_PROGRESS", "FLAG_REVIEW", "AWAITING_PAYMENT", "PAID", "SCORING", "SCORED", "CERTIFIED"] as const;

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-sn-border bg-sn-surface p-5">
      <p className="m-0 text-lg font-bold">{label}</p>
      <p className={`${statNum} mt-3 text-[32px] font-light!`}>{value}</p>
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
        <Loader2 className="size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (statsQuery.isError) {
    return (
      <div className={`${card} text-center`}>
        <p className="text-[15px] text-sn-muted">Failed to load admin stats. Please try again.</p>
        <button type="button" className={`${primaryButton} mt-5`} onClick={() => statsQuery.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const byStatus = stats?.submissionsByStatus ?? {};
  const revenue = (stats?.paidRevenue ?? 0).toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });
  const users = Object.entries(stats?.usersByRole ?? {});

  return (
    <div>
      <div>
        <h1 className={h2}>Admin console</h1>
        <p className={lead}>
          Run assessment operations: pair examiners, track statuses, and settle payments.
        </p>
      </div>

      <section aria-label="Status counts" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="In progress" value={String(byStatus.IN_PROGRESS ?? 0)} />
        <Tile label="Awaiting payment" value={String(byStatus.AWAITING_PAYMENT ?? 0)} />
        <Tile label="Pending grading" value={String(stats?.pendingGrading ?? 0)} />
        <Tile label="Paid revenue" value={revenue} />
      </section>

      <div className="mt-14 grid items-start gap-7 min-[921px]:grid-cols-[2fr_1fr]">
        <section className={card} aria-labelledby="flow-title">
          <h2 id="flow-title" className={h3}>Status flow</h2>
          <p className="mt-2 text-[15px] text-sn-muted">
            Submissions move through stages 1 to 6. Each count is how many sit at that stage now.
          </p>
          <ol className="mt-5 mb-0 grid list-none gap-x-8 p-0 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-3">
            {FLOW.map((s, i) => (
              <li key={s} className="flex items-center gap-4 border-t border-sn-border py-3">
                <span className="w-5 text-sm tabular-nums text-sn-muted" aria-hidden="true">{i + 1}</span>
                <StatusPill status={s} />
                <span className="ml-auto text-xl font-light tabular-nums">{byStatus[s] ?? 0}</span>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-4 border-t border-dashed border-sn-border pt-3">
            <span className="w-5" aria-hidden="true" />
            <StatusPill status="ABANDONED" />
            <span className="text-sm text-sn-muted">Ended while in progress</span>
            <span className="ml-auto text-xl font-light tabular-nums">{byStatus.ABANDONED ?? 0}</span>
          </div>
        </section>

        <section className={card} aria-labelledby="users-title">
          <h2 id="users-title" className={h3}>Users by role</h2>
          <dl className="mt-3 mb-0">
            {users.map(([role, count]) => (
              <div key={role} className="flex items-center justify-between border-t border-sn-border py-3.5">
                <dt className={meta}>{role}</dt>
                <dd className="m-0 tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className="mt-14" aria-labelledby="recent-title">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
          <h2 id="recent-title" className={h3}>Recent submissions</h2>
          <Link href="/admin/submissions" className={`${secondaryButton} max-sm:w-auto`}>
            View all
          </Link>
        </div>
        {stats && stats.recentSubmissions.length > 0 ? (
          <div className={tableWrap}>
            <table className="w-full border-collapse">
              <caption className="sr-only">Recent submissions</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Submission</th>
                  <th scope="col" className={th}>Candidate</th>
                  <th scope="col" className={th}>Created</th>
                  <th scope="col" className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentSubmissions.map((sub) => (
                  <tr key={sub.id} className={tr}>
                    <td className={`${td} font-medium whitespace-nowrap tabular-nums`}>
                      <Link href={`/admin/submissions/${sub.id}`} className="underline-offset-4 hover:underline">
                        {submissionRef(sub.id)}
                      </Link>
                    </td>
                    <td className={`${td} max-w-[24ch] truncate`}>{sub.studentName ?? "—"}</td>
                    <td className={`${td} whitespace-nowrap tabular-nums text-sn-muted`}>
                      {new Date(sub.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className={td}><StatusPill status={sub.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={empty}>No submissions yet. They appear here once students complete a test.</p>
        )}
      </section>

      <section className="mt-14" aria-labelledby="work-title">
        <h2 id="work-title" className={`${h3} mb-4`}>Your examiner work</h2>
        {assignmentsQuery.isPending ? (
          <div className={`${card} flex justify-center`}>
            <Loader2 className="size-6 animate-spin text-sn-muted" role="status" aria-label="Loading assignments" />
          </div>
        ) : assignmentsQuery.isError ? (
          <p className={empty}>Existing examiner assignments could not be loaded. Refresh to try again.</p>
        ) : (
          <AssignmentList assignments={assignmentsQuery.data ?? []} />
        )}
      </section>
    </div>
  );
}
