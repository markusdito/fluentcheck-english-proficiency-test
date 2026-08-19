import type {
  AdminSubmission,
  AssignSubmissionResult,
  Paginated,
} from "@/types/admin";

export function patchAssignedSubmissionPage(
  current: Paginated<AdminSubmission> | undefined,
  result: AssignSubmissionResult,
): Paginated<AdminSubmission> | undefined {
  if (!current) return current;

  return {
    ...current,
    items: current.items.map((item) =>
      item.id === result.submissionId
        ? {
            ...item,
            status: result.status,
            assignments: result.assignments,
          }
        : item,
    ),
  };
}
