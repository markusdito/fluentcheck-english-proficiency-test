import type { QuestionUploadState, UploadStatus } from "@/types/test";

/** Create an explicit state entry for every immutable manifest entry. */
export function initializeUploadStates(entryIds: string[]): Record<string, QuestionUploadState> {
  return Object.fromEntries(entryIds.map((entryId) => [entryId, { status: "idle" as const }]));
}

/** A manifest is complete only when every known entry has server confirmation. */
export function areAllManifestEntriesUploaded(
  entryIds: string[],
  states: Record<string, QuestionUploadState>,
): boolean {
  return entryIds.length > 0 && entryIds.every((entryId) => states[entryId]?.status === "uploaded");
}

/** Navigation is safe only after the current recording has been verified. */
export function canAdvanceFromEntry(
  entryId: string | undefined,
  states: Record<string, QuestionUploadState>,
): boolean {
  return Boolean(entryId && states[entryId]?.status === "uploaded");
}

export function uploadStatusLabel(status: UploadStatus): string | null {
  switch (status) {
    case "finalizing": return "Saving recording...";
    case "blob-ready": return "Recording ready";
    case "signing": return "Preparing upload...";
    case "uploading": return "Uploading video...";
    case "verifying": return "Verifying upload...";
    case "uploaded": return "Uploaded ✓";
    case "failure": return "Upload failed";
    case "error": return "Upload failed";
    default: return null;
  }
}
