import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminQuestionsPage from "@/app/admin/questions/page";
import { ApiError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  fetchAdminQuestions: vi.fn(),
  createQuestion: vi.fn(),
  updateQuestion: vi.fn(),
  retireQuestion: vi.fn(),
  restoreQuestion: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  restoreTask: vi.fn(),
}));

vi.mock("@/lib/admin-api", () => mocks);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <AdminQuestionsPage />
    </QueryClientProvider>,
  );
}

describe("AdminQuestionsPage edit mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAdminQuestions.mockReset().mockResolvedValue([
      {
        id: "question-1",
        category: "PART_1",
        order: 1,
        preparationSeconds: 30,
        recordingSeconds: 120,
        audioStorageKey: "questions/question-1/prompt.webm",
        audioMimeType: "audio/webm",
        audioSizeBytes: 1024,
        audioUploadStatus: "UPLOADED",
        createdAt: "2026-08-19T00:00:00.000Z",
        deletedAt: null,
        tasks: [],
      },
    ]);
  });

  it("retires a Question with truthful retained-evidence feedback", async () => {
    const user = userEvent.setup();
    mocks.retireQuestion.mockResolvedValue(undefined);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Retire" }));

    expect(
      screen.getByRole("heading", { name: "Retire this question?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Prompt media remains available through retained submissions/i,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retire question" }));

    expect(mocks.retireQuestion).toHaveBeenCalledWith("question-1");
    expect(
      await screen.findByText("Question retired. Retained evidence is unchanged."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Order 1/i)).not.toBeInTheDocument();
  });

  it("keeps the Question visible and reports a retirement failure", async () => {
    const user = userEvent.setup();
    mocks.retireQuestion.mockRejectedValue(new Error("network unavailable"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Retire" }));
    await user.click(screen.getByRole("button", { name: "Retire question" }));

    expect(
      await screen.findByText("Failed to retire question."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Order 1/i)).toBeInTheDocument();
  });

  it("hides question creation and part lists while editing", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Create question" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Part 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      screen.getByRole("heading", { name: "Edit question" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Create question" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Part 1" })).not.toBeInTheDocument();
  });

  it("loads active questions by default and exposes an explicit retired view", async () => {
    const user = userEvent.setup();
    const activeQuestion = {
      id: "question-active",
      category: "PART_1",
      order: 1,
      preparationSeconds: 30,
      recordingSeconds: 120,
      audioStorageKey: "questions/active/prompt.webm",
      audioMimeType: "audio/webm",
      audioSizeBytes: 1024,
      audioUploadStatus: "UPLOADED" as const,
      createdAt: "2026-08-19T00:00:00.000Z",
      deletedAt: null,
      tasks: [],
    };
    const retiredQuestion = {
      ...activeQuestion,
      id: "question-retired",
      order: 2,
      deletedAt: "2026-08-20T00:00:00.000Z",
    };
    mocks.fetchAdminQuestions.mockImplementation(
      ({ includeRetired }: { includeRetired?: boolean }) =>
        Promise.resolve(includeRetired ? [activeQuestion, retiredQuestion] : [activeQuestion]),
    );

    renderPage();

    expect(await screen.findByText("Active", { exact: true })).toBeInTheDocument();
    expect(mocks.fetchAdminQuestions).toHaveBeenCalledWith(
      { includeRetired: false },
      expect.any(AbortSignal),
    );
    expect(screen.queryByText("Retired", { exact: true })).not.toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", { name: "Active + retired" }),
    );

    expect(await screen.findByText("Retired", { exact: true })).toBeInTheDocument();
    expect(mocks.fetchAdminQuestions).toHaveBeenLastCalledWith(
      { includeRetired: true },
      expect.any(AbortSignal),
    );
  });

  it("restores a retired Question and reports the successful state transition", async () => {
    const user = userEvent.setup();
    const retiredQuestion = {
      id: "question-retired",
      category: "PART_1",
      order: 2,
      preparationSeconds: 30,
      recordingSeconds: 120,
      audioStorageKey: null,
      audioMimeType: null,
      audioSizeBytes: null,
      audioUploadStatus: "PENDING" as const,
      createdAt: "2026-08-20T00:00:00.000Z",
      deletedAt: "2026-08-21T00:00:00.000Z",
      tasks: [],
    };
    mocks.fetchAdminQuestions.mockImplementation(
      ({ includeRetired }: { includeRetired?: boolean }) =>
        Promise.resolve(includeRetired ? [retiredQuestion] : []),
    );
    mocks.restoreQuestion.mockResolvedValue({ ...retiredQuestion, deletedAt: null });
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Active + retired" }),
    );
    await user.click(await screen.findByRole("button", { name: "Restore question" }));

    expect(mocks.restoreQuestion).toHaveBeenCalledWith("question-retired");
    expect(
      await screen.findByText(
        "Question restored at Part 1, order 2. Child task states are unchanged.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Active", { exact: true })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Restore question" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a retired Question visible and shows the backend conflict message", async () => {
    const user = userEvent.setup();
    const retiredQuestion = {
      id: "question-retired",
      category: "PART_1",
      order: 2,
      preparationSeconds: 30,
      recordingSeconds: 120,
      audioStorageKey: null,
      audioMimeType: null,
      audioSizeBytes: null,
      audioUploadStatus: "PENDING" as const,
      createdAt: "2026-08-20T00:00:00.000Z",
      deletedAt: "2026-08-21T00:00:00.000Z",
      tasks: [],
    };
    mocks.fetchAdminQuestions.mockImplementation(
      ({ includeRetired }: { includeRetired?: boolean }) =>
        Promise.resolve(includeRetired ? [retiredQuestion] : []),
    );
    mocks.restoreQuestion.mockRejectedValue(
      new ApiError("An active question already occupies Part 1/order 2.", 409),
    );
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Active + retired" }),
    );
    await user.click(await screen.findByRole("button", { name: "Restore question" }));

    expect(
      await screen.findByText("An active question already occupies Part 1/order 2."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Question retired")).toBeInTheDocument();
  });

  it("restores a retired Task independently and preserves the parent Question state", async () => {
    const user = userEvent.setup();
    const retiredTask = {
      id: "task-retired",
      promptText: "Describe your hometown.",
      order: 1,
      deletedAt: "2026-08-21T00:00:00.000Z",
    };
    const retiredQuestion = {
      id: "question-retired",
      category: "PART_1",
      order: 2,
      preparationSeconds: 30,
      recordingSeconds: 120,
      audioStorageKey: null,
      audioMimeType: null,
      audioSizeBytes: null,
      audioUploadStatus: "PENDING" as const,
      createdAt: "2026-08-20T00:00:00.000Z",
      deletedAt: "2026-08-21T00:00:00.000Z",
      tasks: [retiredTask],
    };
    mocks.fetchAdminQuestions.mockImplementation(
      ({ includeRetired }: { includeRetired?: boolean }) =>
        Promise.resolve(includeRetired ? [retiredQuestion] : []),
    );
    mocks.restoreTask.mockResolvedValue({ ...retiredTask, deletedAt: null });
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Active + retired" }),
    );
    await user.click(await screen.findByRole("button", { name: "Restore task" }));

    expect(mocks.restoreTask).toHaveBeenCalledWith("question-retired", "task-retired");
    expect(
      await screen.findByText(
        "Task restored at order 1. The parent question's lifecycle is unchanged.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Retired", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore task" })).not.toBeInTheDocument();
  });

  it("reports a retired Task restore conflict without changing either lifecycle state", async () => {
    const user = userEvent.setup();
    const retiredTask = {
      id: "task-retired",
      promptText: "Describe your hometown.",
      order: 1,
      deletedAt: "2026-08-21T00:00:00.000Z",
    };
    const retiredQuestion = {
      id: "question-retired",
      category: "PART_1",
      order: 2,
      preparationSeconds: 30,
      recordingSeconds: 120,
      audioStorageKey: null,
      audioMimeType: null,
      audioSizeBytes: null,
      audioUploadStatus: "PENDING" as const,
      createdAt: "2026-08-20T00:00:00.000Z",
      deletedAt: "2026-08-21T00:00:00.000Z",
      tasks: [retiredTask],
    };
    mocks.fetchAdminQuestions.mockImplementation(
      ({ includeRetired }: { includeRetired?: boolean }) =>
        Promise.resolve(includeRetired ? [retiredQuestion] : []),
    );
    mocks.restoreTask.mockRejectedValue(
      new ApiError("An active task already occupies Question/order 1.", 409),
    );
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Active + retired" }),
    );
    await user.click(await screen.findByRole("button", { name: "Restore task" }));

    expect(
      await screen.findByText("An active task already occupies Question/order 1."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Question retired")).toBeInTheDocument();
    expect(screen.getByLabelText("Task retired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore task" })).toBeInTheDocument();
  });
});
