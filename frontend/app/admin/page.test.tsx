import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminOverviewPage from "@/app/admin/page";
import type { AdminExaminer, AdminQueues } from "@/types/admin";

const mocks = vi.hoisted(() => ({
  fetchAdminStats: vi.fn(),
  fetchAdminQueues: vi.fn(),
  fetchAdminExaminers: vi.fn(),
  assignExaminers: vi.fn(),
  fetchExaminerAssignments: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/admin-api", () => ({
  fetchAdminStats: mocks.fetchAdminStats,
  fetchAdminQueues: mocks.fetchAdminQueues,
  fetchAdminExaminers: mocks.fetchAdminExaminers,
  assignExaminers: mocks.assignExaminers,
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

const emptyQueues: AdminQueues = {
  openFlags: { total: 0, items: [] },
  paymentReconciliation: { total: 0, items: [] },
  assignmentReady: { total: 0, items: [] },
};

const examiners: AdminExaminer[] = [
  { id: "examiner-busy", username: "examiner.busy", email: "busy@example.test", openAssignments: 4 },
  { id: "examiner-idle", username: "examiner.idle", email: "idle@example.test", openAssignments: 0 },
];

describe("admin existing examiner work", () => {
  beforeEach(() => {
    mocks.fetchAdminStats.mockReset().mockResolvedValue({
      usersByRole: { ADMIN: 1 },
      submissionsByStatus: {},
      paidRevenue: 0,
      pendingGrading: 0,
      recentSubmissions: [],
    });
    mocks.fetchAdminQueues.mockReset().mockResolvedValue(emptyQueues);
    mocks.fetchAdminExaminers.mockReset().mockResolvedValue([]);
    mocks.assignExaminers.mockReset();
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

describe("admin review queues and examiner workload", () => {
  beforeEach(() => {
    mocks.fetchAdminStats.mockReset().mockResolvedValue({
      usersByRole: { ADMIN: 1 },
      submissionsByStatus: {},
      paidRevenue: 0,
      pendingGrading: 0,
      recentSubmissions: [],
    });
    mocks.fetchExaminerAssignments.mockReset().mockResolvedValue([]);
    mocks.fetchAdminQueues.mockReset().mockResolvedValue({
      openFlags: {
        total: 1,
        items: [
          {
            id: "flag-1",
            submissionId: "submission-flagged",
            type: "CAMERA_DROP",
            source: "STUDENT_DEVICE",
            reason: "Camera froze during answer two",
            raisedAt: "2026-10-01T09:00:00.000Z",
            studentName: "Flagged Student",
          },
        ],
      },
      paymentReconciliation: {
        total: 1,
        items: [
          {
            reason: "DUPLICATE_PAYMENT",
            paymentId: "payment-dupe",
            submissionId: "submission-paid-twice",
            submissionStatus: "SCORING",
            studentName: "Double Payer",
            paymentStatus: "PAID",
            amount: 150000,
            currency: "IDR",
            merchantReference: "FC-PAY-payment-dupe",
            providerSessionId: null,
            providerTransactionId: null,
            createdAt: "2026-10-02T09:00:00.000Z",
            paidAt: "2026-10-02T09:05:00.000Z",
          },
        ],
      },
      assignmentReady: {
        total: 1,
        items: [
          {
            submissionId: "submission-ready",
            studentName: "Ready Student",
            paymentWaived: true,
            paymentRequired: false,
            createdAt: "2026-10-03T09:00:00.000Z",
            readySince: "2026-10-03T10:00:00.000Z",
          },
        ],
      },
    } satisfies AdminQueues);
    mocks.fetchAdminExaminers.mockReset().mockResolvedValue(examiners);
    mocks.assignExaminers.mockReset().mockResolvedValue({
      submissionId: "submission-ready",
      status: "SCORING",
      outcome: "CREATED",
      assignments: [],
      assignedExaminers: [],
    });
    vi.mocked(toast.success).mockClear();
  });

  it("renders an item from each review queue", async () => {
    renderPage();

    const flags = await screen.findByRole("table", { name: "Open flags" });
    expect(within(flags).getByText("Camera froze during answer two")).toBeInTheDocument();
    expect(within(flags).getByText("Flagged Student")).toBeInTheDocument();

    const reconciliation = screen.getByRole("table", { name: "Payment reconciliation" });
    expect(within(reconciliation).getByText("Paid more than once")).toBeInTheDocument();
    expect(within(reconciliation).getByText("Double Payer")).toBeInTheDocument();

    const ready = screen.getByRole("table", {
      name: "Assignment-ready Submissions without examiners",
    });
    expect(within(ready).getByText("Ready Student")).toBeInTheDocument();
    expect(within(ready).getByRole("button", { name: "Assign" })).toBeInTheDocument();
  });

  it("assigns examiners to an assignment-ready Submission", async () => {
    const user = userEvent.setup();
    renderPage();

    const ready = await screen.findByRole("table", {
      name: "Assignment-ready Submissions without examiners",
    });
    await user.click(within(ready).getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(mocks.assignExaminers).toHaveBeenCalledWith("submission-ready"),
    );
    expect(mocks.assignExaminers).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Examiners assigned"),
    );
  });

  it("lists examiner workload with open assignment counts", async () => {
    renderPage();

    const workload = await screen.findByRole("table", { name: "Examiner workload" });
    const busyRow = within(workload).getByRole("row", { name: /examiner\.busy/ });
    expect(within(busyRow).getByText("4")).toBeInTheDocument();
    const idleRow = within(workload).getByRole("row", { name: /examiner\.idle/ });
    expect(within(idleRow).getByText("0")).toBeInTheDocument();
    expect(mocks.fetchAdminExaminers).toHaveBeenCalled();
  });
});
