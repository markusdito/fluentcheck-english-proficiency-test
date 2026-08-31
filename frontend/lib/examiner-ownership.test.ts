import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { refreshExaminerWorkAfterOwnershipConflict } from "@/lib/examiner-ownership";

describe("examiner ownership conflict recovery", () => {
  it.each([403, 409])("refreshes detail and queue state for HTTP %s", (statusCode) => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
    const assignmentKey = ["examiner-assignment", "assignment-1"];

    expect(
      refreshExaminerWorkAfterOwnershipConflict(
        new ApiError("ownership changed", statusCode),
        queryClient as never,
        assignmentKey,
      ),
    ).toBe(true);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: assignmentKey,
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["assignments", "examiner"],
    });
  });

  it("ignores unrelated errors", () => {
    const queryClient = { invalidateQueries: vi.fn() };

    expect(
      refreshExaminerWorkAfterOwnershipConflict(
        new ApiError("bad request", 400),
        queryClient as never,
        ["assignment"],
      ),
    ).toBe(false);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});
