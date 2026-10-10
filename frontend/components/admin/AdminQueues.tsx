"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { assignExaminers, fetchAdminExaminers, fetchAdminQueues } from "@/lib/admin-api";
import { queryKeys } from "@/lib/query-keys";
import { submissionRef } from "@/components/examiner/ExaminerDashboard";
import { StatusPill } from "@/components/student/StatusPill";
import { card, h3, secondaryButton } from "@/components/student/styles";
import { btnSecondary, empty, tableWrap, td, th, tr } from "@/components/admin/styles";
import type { FlagType, PaymentReconciliationReason } from "@/types/admin";

const FLAG_LABELS: Record<FlagType, string> = {
  TECHNICAL_FAILURE: "Technical failure",
  CAMERA_DROP: "Camera drop",
  INTEGRITY_CONCERN: "Integrity concern",
};

const RECONCILIATION_LABELS: Record<PaymentReconciliationReason, string> = {
  CHECKOUT_UNCONFIRMED: "Checkout never confirmed by the provider",
  NO_PROVIDER_OUTCOME: "No final provider notification",
  DUPLICATE_PAYMENT: "Paid more than once",
  PAID_WHILE_WAIVED: "Paid although payment was waived",
};

function when(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SubmissionLink({ id }: { id: string }) {
  return (
    <Link href={`/admin/submissions/${id}`} className="font-medium tabular-nums underline-offset-4 hover:underline">
      {submissionRef(id)}
    </Link>
  );
}

function QueueSection({
  id,
  title,
  total,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  total: number;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14" aria-labelledby={id}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 id={id} className={h3}>
            {title} <span className="font-light tabular-nums text-sn-muted">({total})</span>
          </h2>
          <p className="mt-1 text-[15px] text-sn-muted">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function AssignButton({ submissionId, onDone }: { submissionId: string; onDone: () => void }) {
  const [pending, setPending] = useState(false);

  async function assign() {
    setPending(true);
    try {
      await assignExaminers(submissionId);
      toast.success("Examiners assigned");
      onDone();
    } catch (err) {
      toast.error("Could not assign examiners", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" className={btnSecondary} disabled={pending} onClick={() => void assign()}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      Assign
    </button>
  );
}

/** Review queues (PRD FR-10.1): open flags, payment reconciliation, assignment-ready Submissions. */
export function AdminQueues() {
  const queryClient = useQueryClient();
  const queuesQuery = useQuery({
    queryKey: queryKeys.adminQueues,
    queryFn: ({ signal }) => fetchAdminQueues(signal),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  };

  if (queuesQuery.isPending) {
    return (
      <div className={`${card} mt-14 flex justify-center`}>
        <Loader2 className="size-6 animate-spin text-sn-muted" role="status" aria-label="Loading queues" />
      </div>
    );
  }
  if (queuesQuery.isError) {
    return <p className={`${empty} mt-14`}>Review queues could not be loaded. Refresh to try again.</p>;
  }

  const { openFlags, paymentReconciliation, assignmentReady } = queuesQuery.data;

  return (
    <>
      <QueueSection
        id="flag-queue-title"
        title="Open flags"
        total={openFlags.total}
        description="Technical failures and integrity concerns waiting for your decision."
        action={
          <Link href="/admin/flags" className={`${secondaryButton} max-sm:w-auto`}>
            Review flags
          </Link>
        }
      >
        {openFlags.items.length === 0 ? (
          <p className={empty}>No open flags.</p>
        ) : (
          <div className={tableWrap}>
            <table className="w-full border-collapse">
              <caption className="sr-only">Open flags</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Submission</th>
                  <th scope="col" className={th}>Candidate</th>
                  <th scope="col" className={th}>Flag</th>
                  <th scope="col" className={th}>Raised</th>
                </tr>
              </thead>
              <tbody>
                {openFlags.items.map((flag) => (
                  <tr key={flag.id} className={tr}>
                    <td className={`${td} whitespace-nowrap`}><SubmissionLink id={flag.submissionId} /></td>
                    <td className={`${td} max-w-[24ch] truncate`}>{flag.studentName}</td>
                    <td className={td}>
                      {FLAG_LABELS[flag.type]}
                      <span className="block max-w-[40ch] truncate text-sm text-sn-muted">{flag.reason}</span>
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums text-sn-muted`}>{when(flag.raisedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueueSection>

      <QueueSection
        id="payment-queue-title"
        title="Payment reconciliation"
        total={paymentReconciliation.total}
        description="Payment attempts with an ambiguous provider outcome. Check them with iPaymu; nothing here changes on its own."
      >
        {paymentReconciliation.items.length === 0 ? (
          <p className={empty}>No payments need reconciliation.</p>
        ) : (
          <div className={tableWrap}>
            <table className="w-full border-collapse">
              <caption className="sr-only">Payment reconciliation</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Submission</th>
                  <th scope="col" className={th}>Candidate</th>
                  <th scope="col" className={th}>Issue</th>
                  <th scope="col" className={th}>Payment</th>
                  <th scope="col" className={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {paymentReconciliation.items.map((item) => (
                  <tr key={`${item.reason}-${item.paymentId}`} className={tr}>
                    <td className={`${td} whitespace-nowrap`}><SubmissionLink id={item.submissionId} /></td>
                    <td className={`${td} max-w-[24ch] truncate`}>{item.studentName}</td>
                    <td className={td}>
                      {RECONCILIATION_LABELS[item.reason]}
                      {item.merchantReference && (
                        <span className="block break-all text-[11px] text-sn-muted">{item.merchantReference}</span>
                      )}
                    </td>
                    <td className={td}><StatusPill status={item.paymentStatus} /></td>
                    <td className={`${td} whitespace-nowrap tabular-nums text-sn-muted`}>{when(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueueSection>

      <QueueSection
        id="ready-queue-title"
        title="Assignment-ready, unassigned"
        total={assignmentReady.total}
        description="Paid or waived Submissions with no examiners yet, usually because fewer than two examiners were available."
      >
        {assignmentReady.items.length === 0 ? (
          <p className={empty}>Every Assignment-ready Submission has examiners.</p>
        ) : (
          <div className={tableWrap}>
            <table className="w-full border-collapse">
              <caption className="sr-only">Assignment-ready Submissions without examiners</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Submission</th>
                  <th scope="col" className={th}>Candidate</th>
                  <th scope="col" className={th}>Payment</th>
                  <th scope="col" className={th}>Ready since</th>
                  <th scope="col" className={th}><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {assignmentReady.items.map((item) => (
                  <tr key={item.submissionId} className={tr}>
                    <td className={`${td} whitespace-nowrap`}><SubmissionLink id={item.submissionId} /></td>
                    <td className={`${td} max-w-[24ch] truncate`}>{item.studentName}</td>
                    <td className={td}><StatusPill status={item.paymentRequired ? "PAID" : "WAIVED"} /></td>
                    <td className={`${td} whitespace-nowrap tabular-nums text-sn-muted`}>{when(item.readySince)}</td>
                    <td className={`${td} text-right`}>
                      <AssignButton submissionId={item.submissionId} onDone={refresh} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueueSection>
    </>
  );
}

/** Open (not completed) assignments per active Examiner. */
export function ExaminerWorkload() {
  const examinersQuery = useQuery({
    queryKey: queryKeys.adminExaminers,
    queryFn: ({ signal }) => fetchAdminExaminers(signal),
  });

  return (
    <section className="mt-14" aria-labelledby="workload-title">
      <h2 id="workload-title" className={`${h3} mb-4`}>Examiner workload</h2>
      {examinersQuery.isPending ? (
        <div className={`${card} flex justify-center`}>
          <Loader2 className="size-6 animate-spin text-sn-muted" role="status" aria-label="Loading workload" />
        </div>
      ) : examinersQuery.isError ? (
        <p className={empty}>Examiner workload could not be loaded. Refresh to try again.</p>
      ) : examinersQuery.data.length === 0 ? (
        <p className={empty}>No active examiners.</p>
      ) : (
        <div className={tableWrap}>
          <table className="w-full border-collapse">
            <caption className="sr-only">Examiner workload</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>Examiner</th>
                <th scope="col" className={th}>Email</th>
                <th scope="col" className={`${th} text-right`}>Open assignments</th>
              </tr>
            </thead>
            <tbody>
              {[...examinersQuery.data]
                .sort((a, b) => b.openAssignments - a.openAssignments || a.username.localeCompare(b.username))
                .map((examiner) => (
                  <tr key={examiner.id} className={tr}>
                    <td className={`${td} font-medium`}>{examiner.username}</td>
                    <td className={`${td} max-w-[32ch] truncate text-sn-muted`}>{examiner.email}</td>
                    <td className={`${td} text-right tabular-nums`}>{examiner.openAssignments}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
