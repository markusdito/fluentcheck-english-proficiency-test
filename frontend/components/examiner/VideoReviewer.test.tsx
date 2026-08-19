import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VideoReviewer } from "@/components/examiner/VideoReviewer";

describe("VideoReviewer", () => {
  it("mounts media only for the active question", () => {
    const answers = [
      {
        id: "answer-1",
        questionId: "question-1",
        questionCategory: "PART_1",
        audioUrl: "https://media.example/prompt-1.mp3",
        tasks: [],
        durationSeconds: 20,
        videoUrl: "https://media.example/answer-1.webm",
        savedScore: null,
      },
      {
        id: "answer-2",
        questionId: "question-2",
        questionCategory: "PART_2",
        audioUrl: "https://media.example/prompt-2.mp3",
        tasks: [],
        durationSeconds: 30,
        videoUrl: "https://media.example/answer-2.webm",
        savedScore: null,
      },
    ];

    const { container } = render(
      <VideoReviewer answers={answers} currentIndex={0} />,
    );

    expect(container.querySelectorAll("audio")).toHaveLength(1);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelector("audio")).toHaveAttribute(
      "src",
      answers[0].audioUrl,
    );
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      answers[0].videoUrl,
    );
  });
});
