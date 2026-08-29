import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { assignmentFailureMessage } from "@/app/admin/submissions/page";

function apiError(
  code: string | undefined,
  message = "fallback message",
  retryable?: boolean,
) {
  return new ApiError(message, 409, undefined, code, retryable);
}

describe("assignmentFailureMessage", () => {
  it("gives the actionable capacity message with retry guidance", () => {
    const message = assignmentFailureMessage(
      apiError("INSUFFICIENT_CAPACITY", "Two Eligible examiners are required", true),
    );
    expect(message).toMatch(/two eligible examiners/i);
    expect(message).toMatch(/try again/i);
  });

  it("gives the busy message for exhausted contention", () => {
    const message = assignmentFailureMessage(
      apiError("ASSIGNMENT_BUSY", "Assignment is busy", true),
    );
    expect(message).toMatch(/busy/i);
    expect(message).toMatch(/try again/i);
  });

  it("identifies invariant violations as requiring data repair", () => {
    const message = assignmentFailureMessage(
      apiError("INVARIANT_VIOLATION", "invalid", false),
    );
    expect(message).toMatch(/data repair/i);
    expect(message).toMatch(/retrying will not fix it/i);
  });

  it("explains non-Assignment-ready submissions", () => {
    const message = assignmentFailureMessage(
      apiError("NOT_ASSIGNMENT_READY", "not ready", false),
    );
    expect(message).toMatch(/paid or waived/i);
  });

  it("reports missing submissions", () => {
    const message = assignmentFailureMessage(
      apiError("SUBMISSION_NOT_FOUND", "not found", false),
    );
    expect(message).toMatch(/no longer exists/i);
  });

  it("falls back to the server message for unknown codes", () => {
    const message = assignmentFailureMessage(
      apiError("SOMETHING_ELSE", "server said so"),
    );
    expect(message).toBe("server said so");
  });

  it("falls back to generic guidance for non-ApiError values", () => {
    expect(assignmentFailureMessage(new Error("boom"))).toBe("Please try again.");
  });
});
