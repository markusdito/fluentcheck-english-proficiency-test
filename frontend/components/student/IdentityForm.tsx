"use client";

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { SessionUser } from "@/types/auth";
import { focusRing, primaryButton } from "@/components/student/styles";
import { cn } from "@/lib/utils";

const field = `min-h-11 w-full rounded-xl border border-sn-border bg-sn-surface px-3 py-2.5 text-[15px] text-sn-fg transition-colors hover:border-sn-fg/32 ${focusRing}`;

/** True once the student set both identity fields spoken in the system check. */
export function hasIdentity(user: SessionUser | null | undefined): boolean {
  return Boolean(user?.fullName?.trim() && user?.studentNumber?.trim());
}

/**
 * PRD FR-1.4: full name and Student ID used in the system-check identity clip
 * ("My name is … and my Student ID is …").
 */
export function IdentityForm({
  user,
  submitLabel = "Save",
  onSaved,
}: {
  user: SessionUser;
  submitLabel?: string;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(user.fullName ?? "");
  const [studentNumber, setStudentNumber] = useState(user.studentNumber ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.patch<{ data: { user: SessionUser } }>("/auth/me", { fullName, studentNumber });
      queryClient.setQueryData(queryKeys.session, res.data.user);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? err.errors : undefined;
      const first = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined;
      setError(first ?? (err instanceof Error ? err.message : "Could not save your details."));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="identity-full-name" className="text-[15px] font-semibold">Full name</label>
        <input
          id="identity-full-name"
          className={field}
          value={fullName}
          maxLength={100}
          autoComplete="name"
          required
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="identity-student-number" className="text-[15px] font-semibold">Student ID</label>
        <input
          id="identity-student-number"
          className={field}
          value={studentNumber}
          maxLength={32}
          required
          onChange={(e) => setStudentNumber(e.target.value)}
        />
      </div>
      <p className={cn("m-0 min-h-[1.55em] text-sm", error ? "text-sn-clay" : "text-sn-muted")} role="status">
        {error ?? (saved ? "Saved." : "")}
      </p>
      <div>
        <button type="submit" className={primaryButton} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
