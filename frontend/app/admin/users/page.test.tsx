import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminUsersPage from "@/app/admin/users/page";

const mocks = vi.hoisted(() => ({
  fetchAdminUsers: vi.fn(),
  fetchRoleTransitionPreview: vi.fn(),
  updateUserRole: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: mocks.useSession,
}));

vi.mock("@/lib/admin-api", () => ({
  fetchAdminUsers: mocks.fetchAdminUsers,
  fetchRoleTransitionPreview: mocks.fetchRoleTransitionPreview,
  updateUserRole: mocks.updateUserRole,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminUsersPage />
    </QueryClientProvider>,
  );
}

describe("admin role transition review", () => {
  const target = {
    id: "target-1",
    username: "target-examiner",
    email: "target@example.test",
    role: "EXAMINER",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const replacement = {
    id: "replacement-1",
    username: "replacement-examiner",
    email: "replacement@example.test",
  };
  const preview = {
    user: { ...target, deletedAt: null },
    requestedRole: "STUDENT",
    assignments: [
      {
        id: "assignment-1",
        submissionId: "submission-1",
        slot: 1,
        status: "ASSIGNED",
        createdAt: "2026-01-02T00:00:00.000Z",
        currentExaminer: target,
        scoreCount: 0,
        transferEligible: true,
        candidates: [replacement],
      },
    ],
  };

  beforeEach(() => {
    mocks.fetchAdminUsers.mockReset().mockResolvedValue({
      items: [target],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    mocks.fetchRoleTransitionPreview.mockReset().mockResolvedValue(preview);
    mocks.updateUserRole.mockReset().mockResolvedValue({
      outcome: "ALREADY_APPLIED",
      user: { ...target, role: "STUDENT", deletedAt: null },
      assignments: [],
    });
    mocks.useSession.mockReturnValue({
      data: {
        id: "admin-1",
        name: "Admin",
        email: "admin@example.test",
        role: "ADMIN",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      isPending: false,
    });
  });

  it("requires every replacement, shows impact, and submits the exact map", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("target-examiner");
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1]!, "STUDENT");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Submission submission-1/)).toBeInTheDocument();
    expect(screen.getByText(/Transfer eligible/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply role change" }),
    ).toBeDisabled();

    const replacementSelect = screen
      .getAllByRole("combobox")
      .find((element) => element.querySelector(`option[value="${replacement.id}"]`));
    if (!replacementSelect) throw new Error("replacement selector was not rendered");
    await user.selectOptions(replacementSelect, replacement.id);
    const apply = screen.getByRole("button", { name: "Apply role change" });
    expect(apply).toBeEnabled();
    await user.click(apply);

    await waitFor(() =>
      expect(mocks.updateUserRole).toHaveBeenCalledWith(
        target.id,
        "STUDENT",
        { "assignment-1": replacement.id },
      ),
    );
    expect(await screen.findByText("Already applied.")).toBeInTheDocument();
  });
});
