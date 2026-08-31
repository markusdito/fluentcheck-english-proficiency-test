import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRoleTransitionPreview,
  updateUserRole,
} from "@/lib/admin-api";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("admin account transition API", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a read-only impact preview with the requested role", async () => {
    const preview = {
      user: {
        id: "user-1",
        username: "examiner",
        email: "examiner@example.test",
        role: "EXAMINER",
        createdAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
      requestedRole: "STUDENT",
      assignments: [],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "success", data: preview }));
    const signal = new AbortController().signal;

    await expect(fetchRoleTransitionPreview("user-1", "STUDENT", signal)).resolves.toEqual(preview);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/backend-api/admin/users/user-1/role-transition-preview?role=STUDENT",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal });
  });

  it("submits the exact assignment replacement map and returns the outcome", async () => {
    const result = {
      outcome: "UPDATED",
      user: {
        id: "user-1",
        username: "examiner",
        email: "examiner@example.test",
        role: "STUDENT",
        createdAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
      assignments: [],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "success", data: result }));

    await expect(
      updateUserRole("user-1", "STUDENT", {
        "assignment-1": "examiner-2",
      }),
    ).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/backend-api/admin/users/user-1/role");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      role: "STUDENT",
      reassignmentMap: { "assignment-1": "examiner-2" },
    });
  });
});
