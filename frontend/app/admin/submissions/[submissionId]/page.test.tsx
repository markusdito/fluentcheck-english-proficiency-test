import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminSubmissionDetailPage from "@/app/admin/submissions/[submissionId]/page";

const mocks = vi.hoisted(() => ({
  fetchAdminSubmissionDetail: vi.fn(),
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

describe("AdminSubmissionDetailPage Payment history", () => {
  beforeEach(() => {
    mocks.fetchAdminSubmissionDetail.mockReset().mockResolvedValue({
      id: "submission-1",
      status: "AWAITING_PAYMENT",
      scoringSystem: "RUBRIC_6",
      paymentRequired: true,
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
    });
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
