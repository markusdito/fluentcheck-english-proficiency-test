"use client";

import { Pill } from "@/components/student/StatusPill";

/** Status pill for a question's prompt audio upload state. */
export function AudioUploadBadge({
  status,
}: {
  status: "PENDING" | "UPLOADED" | "FAILED" | null;
}) {
  if (!status) return <Pill>No audio</Pill>;
  if (status === "UPLOADED") return <Pill tone="green">Audio uploaded</Pill>;
  if (status === "FAILED") return <Pill tone="clay">Audio failed</Pill>;
  return <Pill tone="amber">Audio pending</Pill>;
}
