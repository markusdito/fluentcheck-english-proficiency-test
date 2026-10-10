import { Suspense, type ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import ResultPage from "./page";

const mocks = vi.hoisted(() => ({ fetchSubmissionDetail: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    data: { id: "s1", name: "Casey", email: "c@example.com", role: "STUDENT", createdAt: "2026-01-01T00:00:00Z" },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/useSubmissionStatusPolling", () => ({ useSubmissionStatusPolling: () => undefined }));
vi.mock("@/lib/dashboard-api", () => ({
  fetchSubmissionDetail: mocks.fetchSubmissionDetail,
  paySubmission: vi.fn(),
}));
vi.mock("@/components/student/PageShell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageState: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BackLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/media/LazyAnswerMedia", () => ({ LazyAnswerMedia: () => null }));

const base = {
  id: "sub-1",
  score: null,
  scoringSystem: "RUBRIC_6",
  testSet: { id: "a", code: "A" },
  rubric: null,
  comments: [],
  createdAt: "2026-10-01T00:00:00Z",
  answers: [],
};

async function renderResult(detail: object) {
  mocks.fetchSubmissionDetail.mockResolvedValue({ ...base, ...detail });
  const params = Promise.resolve({ submissionId: "sub-1" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <ResultPage params={params} />
        </Suspense>
      </QueryClientProvider>,
    );
    await params;
  });
}

describe("Result page flag states", () => {
  it("shows Voided with the reason and a free retake action", async () => {
    await renderResult({ status: "VOIDED", voidReason: "Camera off in Part 2", retakeCreditAvailable: true });
    expect(await screen.findByRole("heading", { name: "This test was voided" })).toBeInTheDocument();
    expect(screen.getAllByText("Voided").length).toBeGreaterThan(0);
    expect(screen.getByText("Camera off in Part 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retake for free" })).toHaveAttribute("href", "/dashboard?start=real");
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();
  });

  it("hides the retake action once the credit is used", async () => {
    await renderResult({ status: "VOIDED", voidReason: "x", retakeCreditAvailable: false });
    expect(await screen.findByRole("heading", { name: "This test was voided" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Retake for free" })).not.toBeInTheDocument();
  });

  it("asks for no payment while a flag is under review", async () => {
    await renderResult({ status: "FLAG_REVIEW" });
    expect(await screen.findByRole("heading", { name: "We are checking your recording" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();
  });
});
