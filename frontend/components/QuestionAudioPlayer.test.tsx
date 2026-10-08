import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionAudioPlayer } from "@/components/QuestionAudioPlayer";

describe("QuestionAudioPlayer", () => {
  const play = vi.fn<() => Promise<void>>();
  const pause = vi.fn<() => void>();

  beforeEach(() => {
    play.mockReset().mockResolvedValue(undefined);
    pause.mockReset();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  });

  it("shows only Play/Pause and Replay controls in test autoplay mode", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <QuestionAudioPlayer audioUrl="https://example.com/prompt.webm" autoPlay />,
    );
    const audio = container.querySelector("audio");

    expect(audio).not.toBeNull();
    expect(audio).not.toHaveAttribute("controls");
    expect(screen.getByRole("group", { name: "Question audio controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play question audio" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Replay question audio from the beginning" }),
    ).toBeInTheDocument();

    fireEvent.play(audio!);
    await user.click(screen.getByRole("button", { name: "Pause question audio" }));

    expect(pause).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Play question audio" }));

    expect(play).toHaveBeenCalledTimes(2);
  });

  it("replays from the beginning", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <QuestionAudioPlayer audioUrl="https://example.com/prompt.webm" autoPlay />,
    );
    const audio = container.querySelector("audio");

    expect(audio).not.toBeNull();
    audio!.currentTime = 12;
    await user.click(
      screen.getByRole("button", { name: "Replay question audio from the beginning" }),
    );

    expect(audio!.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("keeps native controls on non-test surfaces", () => {
    const { container } = render(
      <QuestionAudioPlayer audioUrl="https://example.com/answer.webm" />,
    );

    expect(container.querySelector("audio")).toHaveAttribute("controls");
    expect(screen.queryByRole("group", { name: "Question audio controls" })).not.toBeInTheDocument();
  });

  it("preserves the autoplay fallback and ended callback", async () => {
    const onEnded = vi.fn();
    play.mockRejectedValueOnce(new Error("Autoplay blocked"));
    const { container } = render(
      <QuestionAudioPlayer
        audioUrl="https://example.com/prompt.webm"
        autoPlay
        onEnded={onEnded}
      />,
    );

    expect(
      await screen.findByRole("status"),
    ).toHaveTextContent("Autoplay blocked — select Play to hear the prompt.");

    fireEvent.ended(container.querySelector("audio")!);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("allows the autoplay plus one replay, then disables playback (PRD FR-3.4)", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <QuestionAudioPlayer audioUrl="https://example.com/prompt.webm" autoPlay maxPlays={2} />,
    );
    const audio = container.querySelector("audio")!;
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();

    fireEvent.play(audio);
    expect(screen.getByRole("button", { name: "Playing…" })).toBeDisabled();
    fireEvent.ended(audio);
    expect(screen.getByText("1 play left")).toBeInTheDocument();

    audio.currentTime = 30;
    await user.click(screen.getByRole("button", { name: "Replay question" }));
    expect(audio.currentTime).toBe(0);
    fireEvent.play(audio);
    fireEvent.ended(audio);

    expect(screen.getByText("0 plays left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay question" })).toBeDisabled();
  });

  it("does not count a blocked autoplay as a play", async () => {
    play.mockRejectedValueOnce(new Error("Autoplay blocked"));
    render(<QuestionAudioPlayer audioUrl="https://example.com/prompt.webm" autoPlay maxPlays={2} />);
    await screen.findByRole("status");
    expect(screen.getByText("2 plays left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play question" })).toBeEnabled();
  });

  it("disables playback when locked", () => {
    render(<QuestionAudioPlayer audioUrl="https://example.com/prompt.webm" autoPlay maxPlays={2} locked />);
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play question" })).toBeDisabled();
  });
});
