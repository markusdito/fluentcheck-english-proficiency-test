import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import {
  completeSubmission,
  initializeSubmission,
} from "@/lib/test-api";
import {
  confirmUpload,
  getPresignedUrl,
  uploadToR2,
} from "@/lib/upload-api";
import {
  fetchSubmissionStatus,
  paySubmission,
} from "@/lib/dashboard-api";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function noContentResponse() {
  return new Response(null, { status: 204 });
}

function expectJsonRequest(index: number, path: string, body: unknown) {
  const [url, options] = fetchMock.mock.calls[index];
  expect(url).toBe(`/backend-api${path}`);
  expect(options).toMatchObject({
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  expect(JSON.parse(String(options?.body))).toEqual(body);
}

describe("frontend rate-limit flow contract", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("keeps each browser flow within one request per action", async () => {
    const recording = new Blob(["video"], { type: "video/webm" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "success", data: { user: { id: "user-1" } } }))
      .mockResolvedValueOnce(jsonResponse({ status: "success", data: { user: { id: "user-1" } } }))
      .mockResolvedValueOnce(jsonResponse({
        status: "success",
        data: {
          submissionId: "submission-1",
          status: "IN_PROGRESS",
          manifestId: "manifest-1",
          version: 1,
          entries: [],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "success",
        data: {
          presignedUrl: "https://storage.example/answer",
          storageKey: "answers/answer-1.webm",
          answerId: "answer-1",
        },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse({
        status: "success",
        data: {
          paymentUrl: "https://payments.example/checkout",
          merchantReference: "FC-PAY-1",
          amount: 150_000,
          currency: "IDR",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "success",
        data: {
          id: "submission-1",
          status: "AWAITING_PAYMENT",
          updatedAt: "2026-08-30T00:00:00.000Z",
        },
      }))
      .mockResolvedValueOnce(noContentResponse());

    await api.post("/auth/login", {
      email: "student@example.test",
      password: "correct-password",
    });
    await api.post("/auth/register", {
      username: "student",
      email: "student@example.test",
      password: "correct-password",
    });
    const initialized = await initializeSubmission("start-key-1");
    const presigned = await getPresignedUrl(
      initialized.submissionId,
      "entry-1",
      "video/webm",
    );
    await uploadToR2(presigned.presignedUrl, recording);
    await confirmUpload(initialized.submissionId, "entry-1", {
      sizeBytes: recording.size,
      durationSeconds: 12,
    });
    const payment = await paySubmission(initialized.submissionId);
    const status = await fetchSubmissionStatus(initialized.submissionId);
    await completeSubmission(initialized.submissionId);

    expectJsonRequest(0, "/auth/login", {
      email: "student@example.test",
      password: "correct-password",
    });
    expectJsonRequest(1, "/auth/register", {
      username: "student",
      email: "student@example.test",
      password: "correct-password",
    });
    expect(fetchMock.mock.calls[2][0]).toBe("/backend-api/submissions");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "Idempotency-Key": "start-key-1" },
    });
    expect(initialized.submissionId).toBe("submission-1");
    expect(fetchMock.mock.calls[3][0]).toBe("/backend-api/uploads/presigned-url");
    expect(fetchMock.mock.calls[4]).toEqual([
      "https://storage.example/answer",
      expect.objectContaining({
        method: "PUT",
        body: recording,
        headers: { "Content-Type": "video/webm" },
      }),
    ]);
    expect(fetchMock.mock.calls[5][0]).toBe("/backend-api/uploads/confirm");
    expect(fetchMock.mock.calls[6][0]).toBe(
      "/backend-api/payments/submissions/submission-1/pay",
    );
    expect(payment.merchantReference).toBe("FC-PAY-1");
    expect(fetchMock.mock.calls[7][0]).toBe(
      "/backend-api/submissions/submission-1/status",
    );
    expect(status.status).toBe("AWAITING_PAYMENT");
    expect(fetchMock.mock.calls[8][0]).toBe(
      "/backend-api/submissions/submission-1/complete",
    );
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it.each([
    [429, "Too many requests"],
    [503, "Service temporarily unavailable"],
  ] as const)("surfaces HTTP %s without retrying a bounded flow", async (status, message) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: message },
        status,
        { "Retry-After": "30", RateLimit: '"quota"; r=0; t=30' },
      ),
    );

    await expect(paySubmission("submission-1")).rejects.toEqual(
      expect.objectContaining<ApiError>({
        message,
        name: "ApiError",
        statusCode: status,
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
