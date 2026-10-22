import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
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

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("counts plays through the owner and disables playback at zero (PRD FR-3.4)", async () => {
    const user = userEvent.setup();
    const onPlayStarted = vi.fn();
    const props = { audioUrl: "https://example.com/prompt.webm", autoPlay: true, onPlayStarted };
    const { container, rerender } = render(<QuestionAudioPlayer {...props} playsLeft={2} />);
    const audio = container.querySelector("audio")!;
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();

    fireEvent.play(audio);
    expect(onPlayStarted).toHaveBeenCalledTimes(1);
    rerender(<QuestionAudioPlayer {...props} playsLeft={1} />);
    expect(screen.getByRole("button", { name: "Playing…" })).toBeDisabled();
    fireEvent.ended(audio);
    expect(screen.getByText("1 play left")).toBeInTheDocument();

    audio.currentTime = 30;
    await user.click(screen.getByRole("button", { name: "Replay question" }));
    expect(audio.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);

    rerender(<QuestionAudioPlayer {...props} playsLeft={0} />);
    expect(screen.getByText("0 plays left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay question" })).toBeDisabled();
  });

  it("does not autoplay when no plays are left or when locked", () => {
    const { rerender } = render(
      <QuestionAudioPlayer audioUrl="https://example.com/a.webm" autoPlay playsLeft={0} />,
    );
    rerender(<QuestionAudioPlayer audioUrl="https://example.com/b.webm" autoPlay playsLeft={2} locked />);
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play question" })).toBeDisabled();
  });
  describe("recovery when the prompt cannot play", () => {
    const PROMPT = "https://example.com/prompt.webm";
    const FAILURE = "The question audio could not be played. Read the question on screen instead.";

    function setMediaError(audio: HTMLAudioElement, code: number) {
      Object.defineProperty(audio, "error", { configurable: true, value: { code } });
    }

    function audioEl(container: HTMLElement) {
      return container.querySelector("audio")!;
    }

    it("refreshes an expired URL on a media error and resumes without using a play", async () => {
      const onPlayStarted = vi.fn();
      const onFailed = vi.fn();
      const refreshAudioUrl = vi.fn().mockResolvedValue("https://example.com/fresh.webm");
      const { container } = render(
        <QuestionAudioPlayer
          audioUrl={PROMPT}
          autoPlay
          playsLeft={2}
          onPlayStarted={onPlayStarted}
          onFailed={onFailed}
          refreshAudioUrl={refreshAudioUrl}
        />,
      );
      const audio = audioEl(container);
      fireEvent.play(audio);
      audio.currentTime = 7;
      setMediaError(audio, 2);
      fireEvent.error(audio);

      await waitFor(() => expect(audioEl(container)).toHaveAttribute("src", "https://example.com/fresh.webm"));
      const fresh = audioEl(container);
      fireEvent.loadedMetadata(fresh);
      expect(fresh.currentTime).toBe(7);
      expect(play).toHaveBeenCalledTimes(2);
      fireEvent.play(fresh);
      expect(onPlayStarted).toHaveBeenCalledTimes(1);
      expect(onFailed).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("refreshes before any play without counting a play", async () => {
      const onPlayStarted = vi.fn();
      const refreshAudioUrl = vi.fn().mockResolvedValue("https://example.com/fresh.webm");
      const { container } = render(
        <QuestionAudioPlayer
          audioUrl={PROMPT}
          autoPlay
          playsLeft={2}
          onPlayStarted={onPlayStarted}
          refreshAudioUrl={refreshAudioUrl}
        />,
      );
      const audio = audioEl(container);
      setMediaError(audio, 4);
      fireEvent.error(audio);

      await waitFor(() => expect(audioEl(container)).toHaveAttribute("src", "https://example.com/fresh.webm"));
      const fresh = audioEl(container);
      fireEvent.loadedMetadata(fresh);
      expect(play).toHaveBeenCalledTimes(2);
      expect(onPlayStarted).not.toHaveBeenCalled();
      fireEvent.play(fresh);
      expect(onPlayStarted).toHaveBeenCalledTimes(1);
    });

    it("starts the fallback when the refresh fails", async () => {
      const onFailed = vi.fn();
      const refreshAudioUrl = vi.fn().mockRejectedValue(new Error("offline"));
      const { container } = render(
        <QuestionAudioPlayer audioUrl={PROMPT} autoPlay playsLeft={2} onFailed={onFailed} refreshAudioUrl={refreshAudioUrl} />,
      );
      const audio = audioEl(container);
      setMediaError(audio, 2);
      fireEvent.error(audio);

      expect(await screen.findByRole("alert")).toHaveTextContent(FAILURE);
      expect(onFailed).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Play question" })).toBeDisabled();
    });

    it("falls back at once without a refresher", async () => {
      const onFailed = vi.fn();
      const { container } = render(
        <QuestionAudioPlayer audioUrl={PROMPT} autoPlay playsLeft={2} onFailed={onFailed} />,
      );
      const audio = audioEl(container);
      setMediaError(audio, 4);
      fireEvent.error(audio);

      expect(await screen.findByRole("alert")).toHaveTextContent(FAILURE);
      expect(onFailed).toHaveBeenCalledTimes(1);
    });

    it("gives up after two refreshes", async () => {
      const onFailed = vi.fn();
      const refreshAudioUrl = vi
        .fn()
        .mockResolvedValueOnce("https://example.com/fresh-1.webm")
        .mockResolvedValueOnce("https://example.com/fresh-2.webm");
      const { container } = render(
        <QuestionAudioPlayer audioUrl={PROMPT} autoPlay playsLeft={2} onFailed={onFailed} refreshAudioUrl={refreshAudioUrl} />,
      );
      for (const next of ["https://example.com/fresh-1.webm", "https://example.com/fresh-2.webm"]) {
        const audio = audioEl(container);
        setMediaError(audio, 2);
        fireEvent.error(audio);
        await waitFor(() => expect(audioEl(container)).toHaveAttribute("src", next));
      }
      const last = audioEl(container);
      setMediaError(last, 2);
      fireEvent.error(last);

      expect(await screen.findByRole("alert")).toHaveTextContent(FAILURE);
      expect(refreshAudioUrl).toHaveBeenCalledTimes(2);
      expect(onFailed).toHaveBeenCalledTimes(1);
    });

    it("does not report autoplay blocked when the source failed", async () => {
      // jsdom has no MediaError; every element reports an unsupported source.
      Object.defineProperty(HTMLMediaElement.prototype, "error", { configurable: true, get: () => ({ code: 4 }) });
      onTestFinished(() => {
        delete (HTMLMediaElement.prototype as { error?: unknown }).error;
      });
      play.mockRejectedValueOnce(new DOMException("no supported source", "NotSupportedError"));
      render(<QuestionAudioPlayer audioUrl={PROMPT} autoPlay playsLeft={2} />);

      await act(async () => {});
      expect(screen.queryByText(/Autoplay blocked/)).not.toBeInTheDocument();
    });

    it("recovers when play fails on a source whose error event was missed", async () => {
      // jsdom has no MediaError; every element reports a failed source.
      Object.defineProperty(HTMLMediaElement.prototype, "error", { configurable: true, get: () => ({ code: 2 }) });
      onTestFinished(() => {
        delete (HTMLMediaElement.prototype as { error?: unknown }).error;
      });
      play.mockRejectedValueOnce(new DOMException("network error", "NotSupportedError"));
      const refreshAudioUrl = vi.fn(() => new Promise<string>(() => {}));
      render(<QuestionAudioPlayer audioUrl={PROMPT} autoPlay playsLeft={2} refreshAudioUrl={refreshAudioUrl} />);

      await waitFor(() => expect(refreshAudioUrl).toHaveBeenCalledTimes(1));
    });

    it("ignores errors once locked", async () => {
      const onFailed = vi.fn();
      const refreshAudioUrl = vi.fn().mockResolvedValue("https://example.com/fresh.webm");
      const { container } = render(
        <QuestionAudioPlayer audioUrl={PROMPT} autoPlay playsLeft={1} locked onFailed={onFailed} refreshAudioUrl={refreshAudioUrl} />,
      );
      const audio = audioEl(container);
      setMediaError(audio, 2);
      fireEvent.error(audio);

      await act(async () => {});
      expect(refreshAudioUrl).not.toHaveBeenCalled();
      expect(onFailed).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("ignores a refresh that resolves after the prompt changed", async () => {
      const onFailed = vi.fn();
      let resolveRefresh!: (url: string) => void;
      const refreshAudioUrl = vi.fn(() => new Promise<string>((resolve) => { resolveRefresh = resolve; }));
      const props = { autoPlay: true, playsLeft: 2, onFailed, refreshAudioUrl };
      const { container, rerender } = render(<QuestionAudioPlayer audioUrl={PROMPT} {...props} />);
      const audio = audioEl(container);
      setMediaError(audio, 2);
      fireEvent.error(audio);
      expect(refreshAudioUrl).toHaveBeenCalledTimes(1);

      rerender(<QuestionAudioPlayer audioUrl="https://example.com/next.webm" {...props} />);
      await act(async () => resolveRefresh("https://example.com/stale.webm"));

      expect(audioEl(container)).toHaveAttribute("src", "https://example.com/next.webm");
      expect(onFailed).not.toHaveBeenCalled();
    });
  });
  describe("stalled playback", () => {
    const PROMPT = "https://example.com/prompt.webm";

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function renderPlaying(playsLeft = 2) {
      const refreshAudioUrl = vi.fn(() => new Promise<string>(() => {}));
      const { container } = render(
        <QuestionAudioPlayer audioUrl={PROMPT} autoPlay playsLeft={playsLeft} refreshAudioUrl={refreshAudioUrl} />,
      );
      return { audio: container.querySelector("audio")!, refreshAudioUrl };
    }

    it("treats a 10 s stall mid-playback as an error", () => {
      const { audio, refreshAudioUrl } = renderPlaying();
      fireEvent.play(audio);
      fireEvent.waiting(audio);

      act(() => vi.advanceTimersByTime(9_999));
      expect(refreshAudioUrl).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(refreshAudioUrl).toHaveBeenCalledTimes(1);
    });

    it("progress cancels the stall watchdog", () => {
      const { audio, refreshAudioUrl } = renderPlaying();
      fireEvent.play(audio);
      fireEvent.waiting(audio);
      act(() => vi.advanceTimersByTime(5_000));
      fireEvent.timeUpdate(audio);

      act(() => vi.advanceTimersByTime(10_000));
      expect(refreshAudioUrl).not.toHaveBeenCalled();
    });

    it("ignores stalls while nothing is playing", () => {
      const { audio, refreshAudioUrl } = renderPlaying(0);
      fireEvent.stalled(audio);

      act(() => vi.advanceTimersByTime(10_000));
      expect(refreshAudioUrl).not.toHaveBeenCalled();
    });
  });
});
