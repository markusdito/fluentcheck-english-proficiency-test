"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Status chip for a question's prompt audio upload state.
 */
export function AudioUploadBadge({
  status,
}: {
  status: "PENDING" | "UPLOADED" | "FAILED" | null;
}) {
  if (!status) {
    return <Badge variant="outline" data-tone="neutral">No audio</Badge>;
  }
  return (
    <Badge
      variant="outline"
      data-tone={
        status === "UPLOADED" ? "verified" : status === "FAILED" ? "signal" : "amber"
      }
    >
      {status === "UPLOADED"
        ? "Audio uploaded"
        : status === "FAILED"
          ? "Audio failed"
          : "Audio pending"}
    </Badge>
  );
}
