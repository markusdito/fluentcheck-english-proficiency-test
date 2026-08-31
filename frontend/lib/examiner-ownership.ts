import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { queryKeys } from "./query-keys";

export function refreshExaminerWorkAfterOwnershipConflict(
  error: unknown,
  queryClient: QueryClient,
  assignmentKey: readonly unknown[],
): boolean {
  if (
    !(error instanceof ApiError) ||
    (error.statusCode !== 403 && error.statusCode !== 409)
  ) {
    return false;
  }

  void queryClient.invalidateQueries({ queryKey: assignmentKey });
  void queryClient.invalidateQueries({ queryKey: queryKeys.examinerAssignments });
  return true;
}
