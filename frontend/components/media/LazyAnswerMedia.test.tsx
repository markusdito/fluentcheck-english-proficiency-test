import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LazyAnswerMedia } from "@/components/media/LazyAnswerMedia";

describe("LazyAnswerMedia", () => {
  it("mounts one audio/video pair only after activation", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LazyAnswerMedia
        audioUrl="https://media.example/prompt.mp3"
        videoUrl="https://media.example/answer.webm"
        durationSeconds={45}
        questionNumber={1}
      />,
    );

    expect(container.querySelectorAll("audio, video")).toHaveLength(0);

    await user.click(
      screen.getByRole("button", { name: "Load recording for question 1" }),
    );

    expect(container.querySelectorAll("audio")).toHaveLength(1);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelector("video")).toHaveAttribute(
      "preload",
      "metadata",
    );
  });
});
