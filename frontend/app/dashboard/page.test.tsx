import type { ReactNode } from "react";
import { render, waitFor } from "@testing-library/react";
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
    });
    mocks.fetchExaminerAssignments.mockReset().mockResolvedValue([]);
  });

  it("requests only student data for students", async () => {
    mocks.user = { ...baseUser, role: "STUDENT" };
    renderDashboard();

    await waitFor(() =>
      expect(mocks.fetchDashboardStats).toHaveBeenCalledTimes(1),
    );
    expect(mocks.fetchExaminerAssignments).not.toHaveBeenCalled();
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
