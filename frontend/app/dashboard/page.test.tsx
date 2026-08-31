import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/dashboard/page";

const mocks = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    name: string;
    email: string;
    role: "STUDENT" | "EXAMINER" | "ADMIN";
    createdAt: string;
  },
  replace: vi.fn(),
  fetchDashboardStats: vi.fn(),
  fetchExaminerAssignments: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    data: mocks.user,
    error: null,
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/dashboard-api", () => ({
  DASHBOARD_PAGE_SIZE: 10,
  fetchDashboardStats: mocks.fetchDashboardStats,
}));

vi.mock("@/lib/examiner-api", () => ({
  fetchExaminerAssignments: mocks.fetchExaminerAssignments,
}));

vi.mock("@/components/layout/Header", () => ({
  Header: ({ children }: { children?: ReactNode }) => <header>{children}</header>,
}));
vi.mock("@/components/layout/AccountMenu", () => ({
  AccountMenu: () => null,
}));
vi.mock("@/components/hardware/CameraMicPermissionModal", () => ({
  CameraMicPermissionModal: () => null,
}));
vi.mock("@/components/examiner/AssignmentList", () => ({
  AssignmentList: () => null,
}));
vi.mock("@/components/results/ScaleAwareScoreDisplay", () => ({
  ScaleAwareScoreDisplay: () => null,
}));

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

const baseUser = {
  id: "user-1",
  name: "Casey",
  email: "casey@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Dashboard request gating", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.fetchDashboardStats.mockReset().mockResolvedValue({
      totalTests: 0,
      bestScore: null,
      submissions: [],
      pagination: { limit: 10, hasMore: false, nextCursor: null },
    });
    mocks.fetchExaminerAssignments.mockReset().mockResolvedValue([]);
  });

  it("requests only student data for students", async () => {
    mocks.user = { ...baseUser, role: "STUDENT" };
    renderDashboard();

    await waitFor(() =>
      expect(mocks.fetchDashboardStats).toHaveBeenCalledTimes(1),
    );
    expect(mocks.fetchDashboardStats).toHaveBeenCalledWith(
      { limit: 10 },
      expect.any(AbortSignal),
    );
    expect(mocks.fetchExaminerAssignments).not.toHaveBeenCalled();
  });

  it("traverses history pages with cursors and can return to the prior page", async () => {
    mocks.user = { ...baseUser, role: "STUDENT" };
    mocks.fetchDashboardStats
      .mockReset()
      .mockResolvedValueOnce({
        totalTests: 2,
        bestScore: null,
        submissions: [
          {
            id: "submission-1",
            status: "SCORED",
            score: "5.00",
            scoringSystem: "RUBRIC_6",
            createdAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        pagination: { limit: 10, hasMore: true, nextCursor: "cursor-1" },
      })
      .mockResolvedValueOnce({
        totalTests: 2,
        bestScore: null,
        submissions: [
          {
            id: "submission-2",
            status: "SCORED",
            score: "4.50",
            scoringSystem: "RUBRIC_6",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        pagination: { limit: 10, hasMore: false, nextCursor: null },
      });

    renderDashboard();
    await screen.findByRole("link", { name: /Jan 2, 2026/i });
    fireEvent.click(await screen.findByRole("button", { name: "Next history page" }));

    await waitFor(() =>
      expect(mocks.fetchDashboardStats).toHaveBeenCalledTimes(2),
    );
    expect(mocks.fetchDashboardStats.mock.calls[1][0]).toEqual({
      limit: 10,
      cursor: "cursor-1",
    });
    await screen.findByRole("link", { name: /Jan 1, 2026/i });

    fireEvent.click(screen.getByRole("button", { name: "Previous history page" }));
    await waitFor(() =>
      expect(mocks.fetchDashboardStats).toHaveBeenCalledTimes(3),
    );
    expect(mocks.fetchDashboardStats.mock.calls[2][0]).toEqual({ limit: 10 });
  });

  it("requests only assignment data for examiners", async () => {
    mocks.user = { ...baseUser, role: "EXAMINER" };
    renderDashboard();

    await waitFor(() =>
      expect(mocks.fetchExaminerAssignments).toHaveBeenCalledTimes(1),
    );
    expect(mocks.fetchDashboardStats).not.toHaveBeenCalled();
  });

  it("redirects admins without requesting either dashboard endpoint", async () => {
    mocks.user = { ...baseUser, role: "ADMIN" };
    renderDashboard();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/admin"));
    expect(mocks.fetchDashboardStats).not.toHaveBeenCalled();
    expect(mocks.fetchExaminerAssignments).not.toHaveBeenCalled();
  });
});
