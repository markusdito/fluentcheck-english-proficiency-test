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
    return <Badge variant="status">No audio</Badge>;
  }
  return (
    <Badge variant="status">
      {status === "UPLOADED"
        ? "Audio uploaded"
        : status === "FAILED"
          ? "Audio failed"
          : "Audio pending"}
    </Badge>
  );
}
