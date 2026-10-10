import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminSubmissionDetailPage from "@/app/admin/submissions/[submissionId]/page";
import type { AdminExaminer, AdminSubmissionAssignment, AdminSubmissionDetail } from "@/types/admin";

const mocks = vi.hoisted(() => ({
  fetchAdminSubmissionDetail: vi.fn(),
  fetchAdminExaminers: vi.fn(),
  waiveSubmissionPayment: vi.fn(),
  reassignAssignment: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/admin-api", () => mocks);

async function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const params = Promise.resolve({ submissionId: "submission-1" });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback="Loading route">
          <AdminSubmissionDetailPage params={params} />
        </Suspense>
      </QueryClientProvider>,
    );
    await params;
  });
}

function submissionDetail(overrides: Partial<AdminSubmissionDetail> = {}): AdminSubmissionDetail {
  return {
    id: "submission-1",
    status: "AWAITING_PAYMENT",
    scoringSystem: "RUBRIC_6",
    paymentRequired: true,
    testSet: null,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    student: {
      id: "student-1",
      name: "Payment Student",
      email: "student@example.test",
    },
    score: null,
    rubric: null,
    certificate: null,
    payments: [
      {
        id: "payment-new",
        status: "PENDING",
        amount: 150000,
        currency: "IDR",
        provider: "ipaymu",
        merchantReference: "FC-PAY-payment-new",
        providerSessionId: "provider-session-new",
        providerTransactionId: "12345678",
        legacyProviderRef: null,
        paidAt: null,
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
      {
        id: "payment-legacy",
        status: "FAILED",
        amount: 150000,
        currency: "IDR",
        provider: "ipaymu",
        merchantReference: null,
        providerSessionId: null,
        providerTransactionId: null,
        legacyProviderRef: "opaque-historical-reference",
        paidAt: null,
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
      },
    ],
    assignments: [],
    answers: [],
    ...overrides,
  };
}

function assignment(overrides: Partial<AdminSubmissionAssignment>): AdminSubmissionAssignment {
  return {
    id: "assignment-1",
    status: "ASSIGNED",
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    examiner: { id: "examiner-one", name: "Examiner One", email: "one@example.test" },
    score: null,
    ...overrides,
  };
}

const examiners: AdminExaminer[] = [
  { id: "examiner-one", username: "examiner.one", email: "one@example.test", openAssignments: 1 },
  { id: "examiner-two", username: "examiner.two", email: "two@example.test", openAssignments: 2 },
  { id: "examiner-three", username: "examiner.three", email: "three@example.test", openAssignments: 0 },
];

describe("AdminSubmissionDetailPage Payment history", () => {
  beforeEach(() => {
    mocks.fetchAdminSubmissionDetail.mockReset().mockResolvedValue(submissionDetail());
    mocks.fetchAdminExaminers.mockReset().mockResolvedValue(examiners);
    mocks.waiveSubmissionPayment.mockReset().mockResolvedValue({ status: "SCORING" });
    mocks.reassignAssignment.mockReset().mockResolvedValue(undefined);
    vi.mocked(toast.success).mockClear();
  });

  it("labels typed and legacy reconciliation identifiers separately", async () => {
    await renderPage();

    expect(await screen.findByText("FC-PAY-payment-new")).toBeInTheDocument();
    expect(screen.getByText("Merchant reference")).toBeInTheDocument();
    expect(screen.getByText("Provider session ID")).toBeInTheDocument();
    expect(screen.getByText("provider-session-new")).toBeInTheDocument();
    expect(screen.getByText("Provider transaction ID")).toBeInTheDocument();
    expect(screen.getByText("12345678")).toBeInTheDocument();
    expect(screen.getByText("Legacy reference")).toBeInTheDocument();
    expect(screen.getByText("opaque-historical-reference")).toBeInTheDocument();
  });
});

describe("AdminSubmissionDetailPage payment waiver", () => {
  beforeEach(() => {
    mocks.fetchAdminSubmissionDetail.mockReset().mockResolvedValue(submissionDetail());
    mocks.fetchAdminExaminers.mockReset().mockResolvedValue(examiners);
    mocks.waiveSubmissionPayment.mockReset().mockResolvedValue({ status: "SCORING" });
    mocks.reassignAssignment.mockReset().mockResolvedValue(undefined);
    vi.mocked(toast.success).mockClear();
  });

  it("requires a reason before waiving payment for an AWAITING_PAYMENT Submission", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: "Waive payment" }));
    const reason = screen.getByLabelText(/Reason for the waiver/);
    const panel = within(reason.closest("div")!);

    await user.click(panel.getByRole("button", { name: "Waive payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Write the reason for the waiver.",
    );
    expect(mocks.waiveSubmissionPayment).not.toHaveBeenCalled();

    await user.type(reason, "Scholarship approved by finance");
    await user.click(panel.getByRole("button", { name: "Waive payment" }));

    await waitFor(() =>
      expect(mocks.waiveSubmissionPayment).toHaveBeenCalledWith(
        "submission-1",
        "Scholarship approved by finance",
      ),
    );
  });
});

describe("AdminSubmissionDetailPage reassignment", () => {
  beforeEach(() => {
    mocks.fetchAdminSubmissionDetail.mockReset().mockResolvedValue(
      submissionDetail({
        status: "SCORING",
        paymentRequired: true,
        payments: [],
        assignments: [
          assignment({
            id: "assignment-1",
            examiner: { id: "examiner-one", name: "Examiner One", email: "one@example.test" },
            reassignable: true,
          }),
          assignment({
            id: "assignment-2",
            examiner: { id: "examiner-two", name: "Examiner Two", email: "two@example.test" },
            reassignable: false,
          }),
        ],
      }),
    );
    mocks.fetchAdminExaminers.mockReset().mockResolvedValue(examiners);
    mocks.waiveSubmissionPayment.mockReset().mockResolvedValue({ status: "SCORING" });
    mocks.reassignAssignment.mockReset().mockResolvedValue(undefined);
    vi.mocked(toast.success).mockClear();
  });

  it("reassigns to an examiner not already on the Submission", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: "Reassign" }));
    const select = await screen.findByLabelText("New examiner");

    const options = within(select).getAllByRole("option").map((option) => option.textContent);
    expect(options.join(" | ")).toContain("examiner.three");
    expect(options.join(" | ")).not.toContain("examiner.two");
    expect(options.join(" | ")).not.toContain("examiner.one");

    await user.selectOptions(select, "examiner-three");
    await user.type(screen.getByLabelText(/Reason \(kept in the assignment history\)/), "Workload rebalance");
    await user.click(screen.getByRole("button", { name: "Reassign" }));

    await waitFor(() =>
      expect(mocks.reassignAssignment).toHaveBeenCalledWith(
        "assignment-1",
        "examiner-three",
        "Workload rebalance",
      ),
    );
  });

  it("renders reassignment history and the payment waiver", async () => {
    mocks.fetchAdminSubmissionDetail.mockReset().mockResolvedValue(
      submissionDetail({
        status: "SCORING",
        paymentRequired: false,
        payments: [],
        paymentWaiver: {
          reason: "Scholarship approved",
          createdAt: "2026-08-20T00:00:00.000Z",
          adminName: "Admin Ada",
        },
        assignments: [
          assignment({
            id: "assignment-1",
            examiner: { id: "examiner-three", name: "Examiner Three", email: "three@example.test" },
            reassignmentHistory: [
              {
                id: "move-1",
                reason: "ADMIN_REASSIGNMENT",
                note: "Examiner two was overloaded",
                createdAt: "2026-08-26T00:00:00.000Z",
                previousExaminerName: "Examiner Two",
                newExaminerName: "Examiner Three",
                actingAdminName: "Admin Ada",
              },
            ],
          }),
        ],
      }),
    );

    await renderPage();

    const history = await screen.findByRole("list", { name: "Reassignment history" });
    expect(history).toHaveTextContent("Reassigned from Examiner Two to Examiner Three by Admin Ada on");
    expect(history).toHaveTextContent("Examiner two was overloaded");

    expect(
      screen.getByText(/Waived by Admin Ada on .+: Scholarship approved/),
    ).toBeInTheDocument();
  });
});
