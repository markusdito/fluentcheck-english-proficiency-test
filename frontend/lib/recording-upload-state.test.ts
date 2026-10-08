import { describe, expect, it } from "vitest";
import {
  areAllManifestEntriesUploaded,
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

  it("describes the asynchronous upload phases", () => {
    expect(uploadStatusLabel("blob-ready")).toBe("Recording ready");
    expect(uploadStatusLabel("verifying")).toBe("Verifying upload...");
  });
});
