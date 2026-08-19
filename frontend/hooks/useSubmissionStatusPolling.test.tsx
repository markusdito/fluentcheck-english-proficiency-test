import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSubmissionStatusPolling } from "@/hooks/useSubmissionStatusPolling";

const mocks = vi.hoisted(() => ({
  fetchSubmissionStatus: vi.fn(),
}));

vi.mock("@/lib/dashboard-api", () => ({
  fetchSubmissionStatus: mocks.fetchSubmissionStatus,
}));

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useSubmissionStatusPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchSubmissionStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops after five status-only attempts", async () => {
    mocks.fetchSubmissionStatus.mockResolvedValue({
      id: "submission-1",
      status: "AWAITING_PAYMENT",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    renderHook(
      () =>
        useSubmissionStatusPolling({
          submissionId: "submission-1",
          enabled: true,
          onStatusChange: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(mocks.fetchSubmissionStatus).toHaveBeenCalledTimes(5);
  });

  it("stops immediately after confirmation", async () => {
    mocks.fetchSubmissionStatus
      .mockResolvedValueOnce({
        id: "submission-1",
        status: "AWAITING_PAYMENT",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "submission-1",
        status: "SCORING",
        updatedAt: "2026-01-01T00:00:02.000Z",
      });
    const onStatusChange = vi.fn();

    renderHook(
      () =>
        useSubmissionStatusPolling({
          submissionId: "submission-1",
          enabled: true,
          onStatusChange,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(mocks.fetchSubmissionStatus).toHaveBeenCalledTimes(2);
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SCORING" }),
    );
  });
});
