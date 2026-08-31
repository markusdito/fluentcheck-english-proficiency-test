import { describe, expect, it } from "vitest";
import { patchAssignedSubmissionPage } from "@/lib/admin-cache";

describe("patchAssignedSubmissionPage", () => {
  it("patches the assigned row from the mutation response", () => {
    const page = {
      items: [
        {
          id: "submission-1",
          status: "PAID",
          paymentRequired: true,
          studentName: "Student",
          studentEmail: "student@example.com",
          createdAt: "2026-01-01T00:00:00.000Z",
          latestPayment: null,
          assignments: [],
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    };

    const updated = patchAssignedSubmissionPage(page, {
      submissionId: "submission-1",
      status: "SCORING",
      outcome: "CREATED",
      assignments: [
        { id: "assignment-1", status: "ASSIGNED", examinerName: "Examiner" },
      ],
      assignedExaminers: [
        { id: "examiner-1", name: "Examiner", email: "examiner@example.com" },
      ],
    });

    expect(updated?.items[0]).toEqual(
      expect.objectContaining({
        status: "SCORING",
        assignments: [
          expect.objectContaining({ examinerName: "Examiner" }),
        ],
      }),
    );
  });
});
