import { describe, expect, it } from "vitest";
import {
  areAllManifestEntriesUploaded,
  canAdvanceFromEntry,
  initializeUploadStates,
  uploadStatusLabel,
} from "@/lib/recording-upload-state";

describe("recording upload state", () => {
  it("initializes one state for every manifest entry", () => {
    expect(initializeUploadStates(["entry-a", "entry-b"])).toEqual({
      "entry-a": { status: "idle" },
      "entry-b": { status: "idle" },
    });
  });

  it("never treats an empty or partial state map as complete", () => {
    expect(areAllManifestEntriesUploaded([], {})).toBe(false);
    expect(areAllManifestEntriesUploaded(["entry-a", "entry-b"], {
      "entry-a": { status: "uploaded" },
    })).toBe(false);
  });

  it("requires verified upload before leaving the current entry", () => {
    const states = { "entry-a": { status: "blob-ready" as const } };
    expect(canAdvanceFromEntry("entry-a", states)).toBe(false);
    expect(canAdvanceFromEntry("entry-a", { "entry-a": { status: "uploaded" } })).toBe(true);
  });

  it("describes the asynchronous upload phases", () => {
    expect(uploadStatusLabel("blob-ready")).toBe("Recording ready");
    expect(uploadStatusLabel("verifying")).toBe("Verifying upload...");
  });
});
