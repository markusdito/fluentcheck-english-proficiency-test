import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoReviewer } from "@/components/examiner/VideoReviewer";
import { ScoringPanel } from "@/components/examiner/ScoringPanel";
import type { AssignmentAnswer } from "@/types/examiner";

const answer = (overrides: Partial<AssignmentAnswer>): AssignmentAnswer => ({
  id: "answer-1",
  questionId: "entry-1",
  questionCategory: "PART_1A",
  deliveryPosition: 1,
  preparationSeconds: 30,
  recordingSeconds: 60,
  audioUrl: "https://media.example/prompt-1.mp3",
  tasks: [],
  cueCard: null,
  options: null,
  durationSeconds: 20,
  technicalFailure: false,
  technicalFailureReason: null,
  videoUrl: "https://media.example/answer-1.webm",
  ...overrides,
});

const answers = [
  answer({}),
  answer({
    id: "answer-2",
    questionCategory: "PART_2",
    deliveryPosition: 3,
    audioUrl: "https://media.example/prompt-2.mp3",
    videoUrl: "https://media.example/answer-2.webm",
    cueCard: { topic: "A place you visited", points: ["where", "when", "why"] },
  }),
  answer({
    id: "answer-3",
    questionCategory: "PART_3",
    deliveryPosition: 4,
    options: [
      { title: "Park", bullets: ["green", "free"], iconUrl: "https://media.example/park.png" },
      { title: "Library", bullets: ["quiet", "books"], iconUrl: null },
    ],
    technicalFailure: true,
    technicalFailureReason: "Camera dropped",
  }),
];

describe("VideoReviewer", () => {
  it("mounts media only for the active question", () => {
    const { container } = render(<VideoReviewer answers={answers} currentIndex={0} />);

    expect(container.querySelectorAll("audio")).toHaveLength(1);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelector("audio")).toHaveAttribute("src", answers[0].audioUrl);
    expect(container.querySelector("video")).toHaveAttribute("src", answers[0].videoUrl);
    expect(screen.getByRole("heading", { name: "Part 1 · Task 1A" })).toBeInTheDocument();
  });

  it("shows the delivered cue card and decision options", () => {
    const { rerender } = render(<VideoReviewer answers={answers} currentIndex={1} />);
    expect(screen.getByRole("heading", { name: "A place you visited" })).toBeInTheDocument();
    expect(screen.getByText("why")).toBeInTheDocument();

    rerender(<VideoReviewer answers={answers} currentIndex={2} />);
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.getByText("quiet")).toBeInTheDocument();
    expect(screen.getByText("Technical failure reported: Camera dropped")).toBeInTheDocument();
  });

  it("hides the integrity concern control without a handler", () => {
    render(<VideoReviewer answers={answers} currentIndex={0} />);
    expect(screen.queryByRole("button", { name: "Raise integrity concern" })).not.toBeInTheDocument();
  });

  it("raises an integrity concern at the current video time", async () => {
    const onRaiseConcern = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <VideoReviewer answers={answers} currentIndex={0} onRaiseConcern={onRaiseConcern} />,
    );
    Object.defineProperty(container.querySelector("video")!, "currentTime", { value: 42.7 });

    fireEvent.click(screen.getByRole("button", { name: "Raise integrity concern" }));
    const timestamp = screen.getByLabelText("Timestamp (seconds)");
    expect(timestamp).toHaveValue(42);

    fireEvent.change(timestamp, { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Note for the Admin"), { target: { value: "  Reads from notes  " } });
    fireEvent.click(screen.getByRole("button", { name: "Raise concern" }));

    await waitFor(() =>
      expect(onRaiseConcern).toHaveBeenCalledWith({ answerId: "answer-1", timestampSeconds: 45, note: "Reads from notes" }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Note for the Admin")).not.toBeInTheDocument());
  });

  it("leaves the timestamp empty when the Answer has no video", async () => {
    const onRaiseConcern = vi.fn().mockResolvedValue(undefined);
    const missing = [answer({ videoUrl: null })];
    render(<VideoReviewer answers={missing} currentIndex={0} onRaiseConcern={onRaiseConcern} />);

    fireEvent.click(screen.getByRole("button", { name: "Raise integrity concern" }));
    expect(screen.getByLabelText("Timestamp (seconds)")).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("Note for the Admin"), { target: { value: "No recording" } });
    fireEvent.click(screen.getByRole("button", { name: "Raise concern" }));

    await waitFor(() =>
      expect(onRaiseConcern).toHaveBeenCalledWith({ answerId: "answer-1", timestampSeconds: undefined, note: "No recording" }),
    );
  });

  it("shows the error when raising fails", async () => {
    const onRaiseConcern = vi.fn().mockRejectedValue(new Error("Integrity concerns can only be raised while scoring"));
    render(<VideoReviewer answers={answers} currentIndex={0} onRaiseConcern={onRaiseConcern} />);
    fireEvent.click(screen.getByRole("button", { name: "Raise integrity concern" }));
    fireEvent.change(screen.getByLabelText("Note for the Admin"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Raise concern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Integrity concerns can only be raised while scoring");
  });
});

describe("ScoringPanel", () => {
  it("disables saving and completing while paused", () => {
    render(
      <ScoringPanel
        answers={answers}
        scoringSystem="RUBRIC_6"
        savedScore={null}
        currentIndex={0}
        onQuestionChange={() => {}}
        onSave={vi.fn()}
        onComplete={vi.fn()}
        isSubmitting={false}
        paused
      />,
    );
    expect(screen.getByRole("button", { name: "Save & complete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });
});
