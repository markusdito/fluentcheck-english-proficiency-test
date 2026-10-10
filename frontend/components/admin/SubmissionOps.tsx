"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { reassignAssignment, waiveSubmissionPayment } from "@/lib/admin-api";
import type { AdminExaminer } from "@/types/admin";
import { btnPrimary, btnSecondary, error, field, label } from "@/components/admin/styles";

/** Waive payment for one Submission awaiting payment (PRD FR-7.3). The reason is audited. */
export function WaivePaymentPanel({ submissionId, onDone }: { submissionId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const reasonId = `waive-reason-${submissionId}`;

  async function submit() {
    if (!reason.trim()) {
      setFailure("Write the reason for the waiver.");
      return;
    }
    setPending(true);
    setFailure("");
    try {
      const result = await waiveSubmissionPayment(submissionId, reason.trim());
      toast.success("Payment waived", {
        description:
          result.status === "SCORING"
            ? "Two examiners were assigned."
            : "The Submission waits in the assignment-ready queue.",
      });
      setOpen(false);
      setReason("");
      onDone();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not waive payment.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={`${btnSecondary} mt-4`} onClick={() => setOpen(true)}>
        Waive payment
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-sn-border bg-sn-surface px-5 py-4">
      <label className={label} htmlFor={reasonId}>
        Reason for the waiver (kept in the audit record)
        <textarea
          id={reasonId}
          className={`${field} min-h-20`}
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {failure && <p className={`${error} mt-2`} role="alert">{failure}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={pending} onClick={() => void submit()}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Waive payment
        </button>
        <button type="button" className={btnSecondary} disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Move one untouched ASSIGNED assignment to another Examiner (PRD FR-8.3).
 * Examiners already on the Submission are not offered.
 */
export function ReassignAssignmentForm({
  assignmentId,
  examiners,
  excludedExaminerIds,
  onDone,
}: {
  assignmentId: string;
  /** Undefined while the examiner list is loading. */
  examiners: AdminExaminer[] | undefined;
  excludedExaminerIds: string[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [examinerId, setExaminerId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const candidates = (examiners ?? []).filter((examiner) => !excludedExaminerIds.includes(examiner.id));
  const selectId = `reassign-examiner-${assignmentId}`;
  const reasonId = `reassign-reason-${assignmentId}`;

  async function submit() {
    if (!examinerId) {
      setFailure("Choose the new examiner.");
      return;
    }
    if (!reason.trim()) {
      setFailure("Write the reason for the reassignment.");
      return;
    }
    setPending(true);
    setFailure("");
    try {
      await reassignAssignment(assignmentId, examinerId, reason.trim());
      toast.success("Assignment reassigned");
      setOpen(false);
      setExaminerId("");
      setReason("");
      onDone();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not reassign this assignment.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>
        Reassign
      </button>
    );
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-sn-border bg-sn-bg px-4 py-4">
      {!examiners ? (
        <p className="text-sm text-sn-muted">Loading examiners…</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-sn-muted">No other active examiner is available.</p>
      ) : (
        <>
          <label className={label} htmlFor={selectId}>
            New examiner
            <select
              id={selectId}
              className={field}
              value={examinerId}
              onChange={(event) => setExaminerId(event.target.value)}
            >
              <option value="">Choose an examiner</option>
              {candidates.map((examiner) => (
                <option key={examiner.id} value={examiner.id}>
                  {examiner.username} ({examiner.openAssignments} open)
                </option>
              ))}
            </select>
          </label>
          <label className={label} htmlFor={reasonId}>
            Reason (kept in the assignment history)
            <textarea
              id={reasonId}
              className={`${field} min-h-16`}
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </>
      )}
      {failure && <p className={error} role="alert">{failure}</p>}
      <div className="flex flex-wrap gap-2">
        {candidates.length > 0 && (
          <button type="button" className={btnPrimary} disabled={pending} onClick={() => void submit()}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Reassign
          </button>
        )}
        <button type="button" className={btnSecondary} disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
