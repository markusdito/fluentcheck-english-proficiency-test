import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAdminQuestions,
  fetchRoleTransitionPreview,
  restoreQuestion,
  restoreTask,
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

describe("admin question lifecycle API", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the default listing active-only and opts into retired records explicitly", async () => {
    const signal = new AbortController().signal;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "success", data: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: "success", data: [] }));

    await fetchAdminQuestions(undefined, signal);
    await fetchAdminQuestions({ includeRetired: true }, signal);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/backend-api/questions/admin");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/backend-api/questions/admin?includeRetired=true",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ signal });
  });

  it("restores a Question and a Task through their explicit admin endpoints", async () => {
    const question = { id: "question-1" };
    const task = { id: "task-1" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "success", data: question }))
      .mockResolvedValueOnce(jsonResponse({ status: "success", data: task }));

    await expect(restoreQuestion("question-1")).resolves.toEqual(question);
    await expect(restoreTask("question-1", "task-1")).resolves.toEqual(task);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/backend-api/questions/question-1/restore",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/backend-api/questions/question-1/tasks/task-1/restore",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
  });
});
