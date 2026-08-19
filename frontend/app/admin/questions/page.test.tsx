import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminQuestionsPage from "@/app/admin/questions/page";

const mocks = vi.hoisted(() => ({
  fetchAdminQuestions: vi.fn(),
  createQuestion: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
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
        tasks: [],
      },
    ]);
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
});
