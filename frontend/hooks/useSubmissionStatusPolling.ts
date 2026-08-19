"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchSubmissionStatus,
  type SubmissionStatusSnapshot,
} from "@/lib/dashboard-api";
import { queryKeys } from "@/lib/query-keys";

interface SubmissionStatusPollingOptions {
  submissionId: string;
  enabled: boolean;
  onStatusChange: (snapshot: SubmissionStatusSnapshot) => void;
  intervalMs?: number;
  maxAttempts?: number;
}

export function useSubmissionStatusPolling({
  submissionId,
  enabled,
  onStatusChange,
  intervalMs = 2000,
  maxAttempts = 5,
}: SubmissionStatusPollingOptions) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const statusKey = queryKeys.submissionStatus(submissionId);

    const poll = async () => {
      attempts += 1;
      try {
        const snapshot = await queryClient.fetchQuery({
          queryKey: statusKey,
          queryFn: ({ signal }) =>
            fetchSubmissionStatus(submissionId, signal),
          staleTime: 0,
        });
        if (cancelled) return;

        if (snapshot.status !== "AWAITING_PAYMENT") {
          onStatusChange(snapshot);
          return;
        }

        if (attempts < maxAttempts) {
          timer = setTimeout(poll, intervalMs);
        }
      } catch {
        // Stop after a failed status check; the user can refresh later.
      }
    };

    timer = setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      void queryClient.cancelQueries({ queryKey: statusKey, exact: true });
    };
  }, [enabled, intervalMs, maxAttempts, onStatusChange, queryClient, submissionId]);
}
