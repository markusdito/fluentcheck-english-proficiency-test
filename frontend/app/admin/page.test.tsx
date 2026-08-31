import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminOverviewPage from "@/app/admin/page";

const mocks = vi.hoisted(() => ({
  fetchAdminStats: vi.fn(),
  fetchExaminerAssignments: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock("@/lib/admin-api", () => ({
  fetchAdminStats: mocks.fetchAdminStats,
}));

vi.mock("@/lib/examiner-api", () => ({
  fetchExaminerAssignments: mocks.fetchExaminerAssignments,
}));

vi.mock("@/components/examiner/AssignmentList", () => ({
  AssignmentList: ({ assignments }: { assignments: unknown[] }) => (
    <div data-testid="assignment-list">{assignments.length} assignments</div>
  ),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminOverviewPage />
    </QueryClientProvider>,
  );
}

describe("admin existing examiner work", () => {
  beforeEach(() => {
    mocks.fetchAdminStats.mockReset().mockResolvedValue({
      usersByRole: { ADMIN: 1 },
      submissionsByStatus: {},
      paidRevenue: 0,
      pendingGrading: 0,
      recentSubmissions: [],
    });
    mocks.fetchExaminerAssignments.mockReset().mockResolvedValue([
      {
        id: "assignment-1",
        status: "ASSIGNED",
        submissionId: "submission-1",
        studentName: "Student",
        submissionStatus: "SCORING",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("loads existing examiner assignments for an ADMIN account", async () => {
    renderPage();

    await waitFor(() =>
      expect(mocks.fetchExaminerAssignments).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByTestId("assignment-list")).toHaveTextContent(
      "1 assignments",
    );
  });
});
