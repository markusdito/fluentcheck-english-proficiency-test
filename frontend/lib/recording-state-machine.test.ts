import { describe, expect, it } from "vitest";
import {
  entryReducer,
  initialEntryState,
  type EntryEvent,
} from "./recording-state-machine";

function reduce(...events: EntryEvent[]) {
  return events.reduce(entryReducer, initialEntryState());
}

describe("recording entry state machine", () => {
  it("does not become blob-ready until a non-empty finalized blob exists", () => {
    expect(reduce({ type: "START_RECORDING" }, { type: "STOP_REQUESTED" }).state).toBe("finalizing");
    expect(reduce(
      { type: "START_RECORDING" },
      { type: "STOP_REQUESTED" },
      { type: "BLOB_READY", blob: new Blob() },
    ).state).toBe("finalizing");
    expect(reduce(
      { type: "START_RECORDING" },
      { type: "STOP_REQUESTED" },
      { type: "BLOB_READY", blob: new Blob(["video"]) },
    ).state).toBe("blob-ready");
  });

  it("requires verification before completion and preserves retryable failures", () => {
    const ready = reduce(
      { type: "START_RECORDING" }, { type: "STOP_REQUESTED" },
      { type: "BLOB_READY", blob: new Blob(["video"]) },
    );
    expect(entryReducer(ready, { type: "UPLOAD_STARTED" }).state).toBe("signing");
    const verifying = entryReducer(entryReducer(ready, { type: "UPLOAD_STARTED" }), { type: "SIGNED" });
    expect(entryReducer(verifying, { type: "UPLOAD_STARTED" }).state).toBe("uploading");
    const failed = entryReducer(verifying, { type: "FAILED", message: "offline" });
    expect(failed.state).toBe("failure");
    expect(failed.error).toBe("offline");
    expect(entryReducer(failed, { type: "RETRY" }).state).toBe("blob-ready");
  });

  it("cannot mutate terminal entries", () => {
    const complete = reduce(
      { type: "START_RECORDING" }, { type: "STOP_REQUESTED" },
      { type: "BLOB_READY", blob: new Blob(["video"]) },
      { type: "UPLOAD_STARTED" }, { type: "SIGNED" }, { type: "UPLOAD_FINISHED" },
      { type: "VERIFIED" },
    );
    expect(complete.state).toBe("verified");
    expect(entryReducer(complete, { type: "START_RECORDING" })).toBe(complete);
  });
});
