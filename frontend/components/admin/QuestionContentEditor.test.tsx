import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionContentEditor } from "@/components/admin/QuestionContentEditor";
import type { AdminQuestion } from "@/types/admin";

const mocks = vi.hoisted(() => ({ updateQuestion: vi.fn(), uploadOptionIcon: vi.fn() }));
vi.mock("@/lib/admin-api", () => mocks);

function question(category: string, extra: Partial<AdminQuestion> = {}): AdminQuestion {
  return {
    id: "q-1",
    category,
    testSetId: "set-a",
    testSet: { id: "set-a", code: "A" },
    preparationSeconds: 60,
    recordingSeconds: 90,
    audioStorageKey: null,
    audioMimeType: null,
    audioSizeBytes: null,
    audioUploadStatus: "PENDING",
    createdAt: "2026-10-08T00:00:00.000Z",
    tasks: [],
    ...extra,
  };
}

const savedOptions = [0, 1, 2, 3].map((index) => ({
  title: `Option ${index + 1}`,
  bullets: ["Pro", "Con"],
  icon: index === 0 ? { storageKey: "k", mimeType: "image/png", sizeBytes: 1 } : null,
  iconUrl: index === 0 ? "https://icons.test/0.png" : null,
}));

describe("QuestionContentEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing for Part 1 and Part 4", () => {
    const { container } = render(<QuestionContentEditor question={question("PART_1A")} onSaved={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("saves a Part 2 cue card with a topic and three points", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    mocks.updateQuestion.mockResolvedValue(question("PART_2"));
    render(<QuestionContentEditor question={question("PART_2")} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Save cue card" }));
    expect(screen.getByRole("alert")).toHaveTextContent("topic and all three points");
    expect(mocks.updateQuestion).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Topic"), "A trip");
    await user.type(screen.getByLabelText("Point 1"), "Where");
    await user.type(screen.getByLabelText("Point 2"), "Who");
    await user.type(screen.getByLabelText("Point 3"), "Why");
    await user.click(screen.getByRole("button", { name: "Save cue card" }));
    expect(mocks.updateQuestion).toHaveBeenCalledWith("q-1", {
      cueCard: { topic: "A trip", points: ["Where", "Who", "Why"] },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("lists Part 3 options with icon status and uploads an icon", async () => {
    const user = userEvent.setup();
    const part3 = question("PART_3", { options: savedOptions });
    mocks.uploadOptionIcon.mockResolvedValue(undefined);
    mocks.updateQuestion.mockResolvedValue(part3);
    render(<QuestionContentEditor question={part3} onSaved={vi.fn()} />);

    expect(screen.getByText(/not deliverable until all four icons are uploaded \(3 missing\)/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Option 1 icon" })).toBeInTheDocument();

    const file = new File(["x"], "icon.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Option 2 icon"), file);
    expect(mocks.uploadOptionIcon).toHaveBeenCalledWith("q-1", 1, file);
  });

  it("requires the option texts to be saved before icons can be uploaded", () => {
    render(<QuestionContentEditor question={question("PART_3")} onSaved={vi.fn()} />);
    expect(screen.getByLabelText("Option 1 icon")).toBeDisabled();
    expect(screen.getByText("Save the four options before uploading icons.")).toBeInTheDocument();
  });
});
