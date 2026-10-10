"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { confirmFlag, dismissFlag, fetchOpenFlags } from "@/lib/admin-api";
import { slotLabel } from "@/lib/assessment-slots";
import { queryKeys } from "@/lib/query-keys";
import { card, h2, h3, meta, primaryButton } from "@/components/student/styles";
import { btnDanger, btnSecondary, empty, error, field, label, lead } from "@/components/admin/styles";
import type { AdminOpenFlag, FlagType } from "@/types/admin";

const TYPE_LABELS: Record<FlagType, string> = {
  TECHNICAL_FAILURE: "Technical failure",
  CAMERA_DROP: "Camera drop",
  INTEGRITY_CONCERN: "Integrity concern",
};

function FlagCard({ flag, onResolved }: { flag: AdminOpenFlag; onResolved: () => void }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"confirm" | "dismiss" | null>(null);
  const [failure, setFailure] = useState("");
  const noteId = `flag-note-${flag.id}`;

  async function resolve(action: "confirm" | "dismiss") {
    if (!note.trim()) {
      setFailure("Write a note explaining the decision.");
      return;
    }
    setPending(action);
    setFailure("");
    try {
      await (action === "confirm" ? confirmFlag : dismissFlag)(flag.id, note.trim());
      toast.success(action === "confirm" ? "Submission voided" : "Flag dismissed", {
        description:
          action === "confirm"
            ? `${flag.studentName} gets one free retake.`
            : "The Submission continues where it was.",
      });
      onResolved();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not resolve this flag.");
    } finally {
      setPending(null);
    }
  }

  return (
    <li className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={h3}>{TYPE_LABELS[flag.type]}</h2>
        <p className={meta}>Raised {new Date(flag.raisedAt).toLocaleString()}</p>
      </div>
      <p className="mt-1 text-[15px] text-sn-muted">
        <Link href={`/admin/submissions/${flag.submissionId}`} className="font-medium text-sn-fg underline-offset-4 hover:underline">
          {flag.studentName}
        </Link>
        {` · ${flag.studentEmail}`}
        {flag.slot && ` · ${slotLabel(flag.slot)}`}
        {flag.timestampSeconds != null && ` · at ${flag.timestampSeconds}s`}
        {flag.source === "EXAMINER" && flag.raisedBy && ` · raised by examiner ${flag.raisedBy}`}
      </p>
      <p className="mt-3 text-[15px]">{flag.reason}</p>
      {flag.videoUrl ? (
        <video className="mt-4 w-full max-w-xl rounded-xl bg-black" src={flag.videoUrl} controls preload="metadata" />
      ) : (
        <p className={`${meta} mt-4`}>No Answer video for this flag. Open the Submission to see all Answers.</p>
      )}
      <label className={`${label} mt-5`} htmlFor={noteId}>
        Decision note (shown to the student if you void)
        <textarea
          id={noteId}
          className={`${field} min-h-20`}
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {failure && <p className={`${error} mt-2`} role="alert">{failure}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={btnDanger} disabled={pending !== null} onClick={() => void resolve("confirm")}>
          {pending === "confirm" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Confirm and void
        </button>
        <button type="button" className={btnSecondary} disabled={pending !== null} onClick={() => void resolve("dismiss")}>
          {pending === "dismiss" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Dismiss
        </button>
      </div>
    </li>
  );
}

export default function AdminFlagsPage() {
  const queryClient = useQueryClient();
  const flagsQuery = useQuery({
    queryKey: queryKeys.adminFlags,
    queryFn: ({ signal }) => fetchOpenFlags(signal),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminFlags });
    void queryClient.invalidateQueries({ queryKey: ["admin", "submissions"] });
  };

  return (
    <div>
      <h1 className={h2}>Flags</h1>
      <p className={lead}>
        Submissions with an open technical-failure or integrity flag are never scored. Confirm a flag to void the
        Submission and give the student a free retake, or dismiss it as a false alarm.
      </p>
      <div className="mt-10">
        {flagsQuery.isPending ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
          </div>
        ) : flagsQuery.isError ? (
          <div className={`${card} text-center`}>
            <p className="text-[15px] text-sn-muted">Failed to load flags.</p>
            <button type="button" className={`${primaryButton} mt-5`} onClick={() => flagsQuery.refetch()}>
              Try again
            </button>
          </div>
        ) : flagsQuery.data.length === 0 ? (
          <p className={empty}>No open flags.</p>
        ) : (
          <ul className="grid gap-4" role="list">
            {flagsQuery.data.map((flag) => (
              <FlagCard key={flag.id} flag={flag} onResolved={refresh} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
