import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import AdminFlagsPage from "@/app/admin/flags/page";
import type { AdminFlagAnswer, AdminOpenFlag } from "@/types/admin";

const mocks = vi.hoisted(() => ({ fetchOpenFlags: vi.fn() }));

vi.mock("@/lib/admin-api", () => ({
  fetchOpenFlags: mocks.fetchOpenFlags,
  confirmFlag: vi.fn(),
  dismissFlag: vi.fn(),
}));

const slots = ["PART_1A", "PART_1B", "PART_2", "PART_3", "PART_4"];
const answers: AdminFlagAnswer[] = slots.map((slot, index) => ({
  answerId: `answer-${index + 1}`,
  manifestEntryId: `entry-${index + 1}`,
  questionCategory: slot,
  deliveryPosition: index + 1,
  tasks: [],
  cueCard: slot === "PART_2" ? { topic: "A trip", points: ["a", "b", "c"] } : null,
  options: null,
  videoUrl: `https://media.example/answer-${index + 1}.webm`,
}));

const flag: AdminOpenFlag = {
  id: "flag-1",
  submissionId: "sub-1",
  type: "INTEGRITY_CONCERN",
  source: "EXAMINER",
  reason: "Reads from notes",
  answerId: "answer-3",
  manifestEntryId: "entry-3",
  timestampSeconds: 75,
  raisedAt: "2026-10-01T00:00:00Z",
  raisedBy: "examiner-1",
  slot: "PART_2",
  studentName: "Casey",
  studentEmail: "c@example.com",
  submissionCreatedAt: "2026-10-01T00:00:00Z",
  videoUrl: "https://media.example/answer-3.webm",
  answers,
};

describe("Admin flags page", () => {
  it("offers every Answer video of the flagged Submission in slot order", async () => {
    mocks.fetchOpenFlags.mockResolvedValue([flag]);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AdminFlagsPage />
      </QueryClientProvider>,
    );

    const list = await screen.findByRole("list", { name: "Answer videos" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("p")?.textContent)).toEqual([
      "Part 1 · Task 1A",
      "Part 1 · Task 1B",
      "Part 2 · Monologue",
      "Part 3 · Decision-making",
      "Part 4 · Opinion",
    ]);
    expect(within(items[2]).getByText("Flagged at 1:15")).toBeInTheDocument();
    expect(within(items[2]).getByText("Cue card: A trip")).toBeInTheDocument();
    expect(screen.getByText("Reads from notes")).toBeInTheDocument();

    // Lazy: no video loads until requested.
    expect(document.querySelectorAll("video")).toHaveLength(0);
    fireEvent.click(within(items[4]).getByRole("button", { name: /load recording/i }));
    expect(document.querySelector("video")).toHaveAttribute("src", answers[4].videoUrl);
  });
});
