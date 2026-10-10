"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { confirmFlag, dismissFlag, fetchOpenFlags } from "@/lib/admin-api";
import { slotLabel } from "@/lib/assessment-slots";
import { queryKeys } from "@/lib/query-keys";
import { LazyAnswerMedia } from "@/components/media/LazyAnswerMedia";
import { Pill } from "@/components/student/StatusPill";
import { card, h2, h3, meta, primaryButton } from "@/components/student/styles";
import { btnDanger, btnSecondary, empty, error, field, label, lead } from "@/components/admin/styles";
import type { AdminFlagAnswer, AdminOpenFlag, FlagType } from "@/types/admin";

const TYPE_LABELS: Record<FlagType, string> = {
  TECHNICAL_FAILURE: "Technical failure",
  CAMERA_DROP: "Camera drop",
  INTEGRITY_CONCERN: "Integrity concern",
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** One-line summary of the Delivered prompt snapshot. */
function promptSummary(answer: AdminFlagAnswer): string | null {
  if (answer.cueCard) return `Cue card: ${answer.cueCard.topic}`;
  if (answer.options?.length) return `Options: ${answer.options.map((option) => option.title).join(", ")}`;
  if (answer.tasks.length) return answer.tasks.map((task) => task.promptText).join(" · ");
  return null;
}

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
        {flag.timestampSeconds != null && ` · at ${clock(flag.timestampSeconds)}`}
        {flag.source === "EXAMINER" && flag.raisedBy && ` · raised by examiner ${flag.raisedBy}`}
      </p>
      <p className="mt-3 text-[15px]">{flag.reason}</p>
      {flag.answers.length > 0 ? (
        <ol className="mt-4 grid list-none gap-4 p-0" aria-label="Answer videos">
          {flag.answers.map((answer, index) => {
            const flagged =
              answer.answerId === flag.answerId ||
              (!flag.answerId && flag.manifestEntryId != null && answer.manifestEntryId === flag.manifestEntryId);
            const summary = promptSummary(answer);
            return (
              <li
                key={answer.answerId}
                className={`rounded-xl border p-4 ${flagged ? "border-sn-ink-amber" : "border-sn-border"}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className={meta}>{answer.questionCategory ? slotLabel(answer.questionCategory) : `Answer ${index + 1}`}</p>
                  {flagged && (
                    <Pill tone="amber">
                      Flagged{flag.timestampSeconds != null && ` at ${clock(flag.timestampSeconds)}`}
                    </Pill>
                  )}
                </div>
                {summary && <p className="mb-3 text-sm text-sn-muted">{summary}</p>}
                <LazyAnswerMedia
                  audioUrl={null}
                  videoUrl={answer.videoUrl}
                  questionNumber={index + 1}
                  unavailableMessage="Video not available"
                />
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={`${meta} mt-4`}>No Answer videos for this Submission.</p>
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
