import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptDisplay } from "@/components/test/PromptDisplay";

const player = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));

vi.mock("@/components/QuestionAudioPlayer", () => ({
  QuestionAudioPlayer: (props: Record<string, unknown>) => {
    player.props = props;
    return null;
  },
}));

describe("PromptDisplay", () => {
  it("renders the Part 2 cue card topic and its three points", () => {
    render(
      <PromptDisplay
        questionNumber={3}
        totalQuestions={5}
        audioUrl={null}
        cueCard={{ topic: "A memorable trip", points: ["Where", "Who with", "Why"] }}
      />,
    );
    expect(screen.getByRole("heading", { name: "A memorable trip" })).toBeInTheDocument();
    for (const point of ["Where", "Who with", "Why"]) expect(screen.getByText(point)).toBeInTheDocument();
  });

  it("renders four Part 3 options as text with icons and asks to choose ONE", () => {
    const options = [1, 2, 3, 4].map((n) => ({
      title: `Option ${n} title`,
      bullets: [`Pro ${n}`, `Con ${n}`],
      iconUrl: `https://icons.test/${n}.png`,
    }));
    const { container } = render(
      <PromptDisplay questionNumber={4} totalQuestions={5} audioUrl={null} options={options} />,
    );
    expect(screen.getByText(/Choose/)).toHaveTextContent("Choose ONE option");
    const section = screen.getByRole("region");
    const items = within(section).getAllByRole("listitem").filter((item) => item.querySelector("img"));
    expect(items).toHaveLength(4);
    items.forEach((item, index) => {
      expect(item).toHaveTextContent(`Option ${index + 1} title`);
      expect(item).toHaveTextContent(`Pro ${index + 1}`);
      expect(item).toHaveTextContent(`Con ${index + 1}`);
    });
    expect(container.querySelectorAll("img")).toHaveLength(4);
  });

  it("forwards audio recovery props to the player", () => {
    const refreshAudioUrl = vi.fn();
    const onAudioFailed = vi.fn();
    render(
      <PromptDisplay
        questionNumber={1}
        totalQuestions={5}
        audioUrl="https://r2.example/p1.webm"
        autoPlay
        refreshAudioUrl={refreshAudioUrl}
        onAudioFailed={onAudioFailed}
      />,
    );
    expect(player.props.refreshAudioUrl).toBe(refreshAudioUrl);
    expect(player.props.onFailed).toBe(onAudioFailed);
  });
});
