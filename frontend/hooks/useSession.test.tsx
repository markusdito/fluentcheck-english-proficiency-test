import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { useSession } from "@/hooks/useSession";

function SessionConsumer() {
  const session = useSession();
  return (
    <span>
      {session.data === null ? "Signed out" : session.data?.name ?? "Loading"}
    </span>
  );
}

describe("useSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deduplicates simultaneous session consumers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: {
          user: {
            id: "user-1",
            name: "Casey",
            email: "casey@example.com",
            role: "STUDENT",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryProvider>
        <SessionConsumer />
        <SessionConsumer />
      </QueryProvider>,
    );

    expect(await screen.findAllByText("Casey")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/backend-api/auth/me");
  });

  it("caches an unauthenticated session as shared data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Not authenticated" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryProvider>
        <SessionConsumer />
        <SessionConsumer />
      </QueryProvider>,
    );

    expect(await screen.findAllByText("Signed out")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
