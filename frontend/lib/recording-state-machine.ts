export type EntryState =
  | "preparation" | "recording" | "finalizing" | "blob-ready"
  | "signing" | "uploading" | "verifying" | "verified" | "failure";

export interface EntryMachineState {
  state: EntryState;
  blob: Blob | null;
  error: string | null;
}

export type EntryEvent =
  | { type: "START_RECORDING" }
  | { type: "STOP_REQUESTED" }
  | { type: "BLOB_READY"; blob: Blob }
  | { type: "UPLOAD_STARTED" }
  | { type: "SIGNED" }
  | { type: "UPLOAD_FINISHED" }
  | { type: "VERIFIED" }
  | { type: "FAILED"; message: string }
  | { type: "RETRY" }
  | { type: "RESET" };

export function initialEntryState(): EntryMachineState {
  return { state: "preparation", blob: null, error: null };
}

export function entryReducer(current: EntryMachineState, event: EntryEvent): EntryMachineState {
  if (current.state === "verified" && event.type !== "RESET") return current;
  switch (event.type) {
    case "START_RECORDING": return current.state === "preparation" || current.state === "failure"
      ? { state: "recording", blob: null, error: null } : current;
    case "STOP_REQUESTED": return current.state === "recording" ? { ...current, state: "finalizing" } : current;
    case "BLOB_READY": return current.state === "finalizing" && event.blob.size > 0
      ? { state: "blob-ready", blob: event.blob, error: null } : current;
    case "UPLOAD_STARTED": return current.state === "blob-ready" ? { ...current, state: "signing", error: null } : current;
    case "SIGNED": return current.state === "signing" ? { ...current, state: "uploading" } : current;
    case "UPLOAD_FINISHED": return current.state === "uploading" ? { ...current, state: "verifying" } : current;
    case "VERIFIED": return current.state === "verifying" ? { ...current, state: "verified" } : current;
    case "FAILED": return ["signing", "uploading", "verifying"].includes(current.state)
      ? { ...current, state: "failure", error: event.message } : current;
    case "RETRY": return current.state === "failure" && current.blob ? { ...current, state: "blob-ready", error: null } : current;
    case "RESET": return initialEntryState();
  }
}

export type EntryMachineEvent = { entryId: string; event: EntryEvent };

export function entryMachinesReducer(
  current: Record<string, EntryMachineState>,
  action: EntryMachineEvent,
): Record<string, EntryMachineState> {
  const previous = current[action.entryId] ?? initialEntryState();
  const next = entryReducer(previous, action.event);
  return next === previous ? current : { ...current, [action.entryId]: next };
}
