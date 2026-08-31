import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "@/hooks/useCountdown";

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down to completion and invokes the latest callback once", () => {
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const { result, rerender } = renderHook(
      ({ onComplete }) => useCountdown(2, onComplete),
      { initialProps: { onComplete: firstCallback } },
    );

    expect(result.current.seconds).toBe(2);
    expect(result.current.formatted).toBe("0:02");
    expect(result.current.isRunning).toBe(false);

    act(() => {
      result.current.start();
    });
    expect(result.current.isRunning).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.seconds).toBe(1);
    expect(result.current.formatted).toBe("0:01");

    rerender({ onComplete: latestCallback });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.seconds).toBe(0);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isComplete).toBe(true);
    expect(latestCallback).toHaveBeenCalledTimes(1);
    expect(firstCallback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(latestCallback).toHaveBeenCalledTimes(1);
  });

  it("pauses at the current value and reset restores the initial value", () => {
    const { result } = renderHook(() => useCountdown(65));

    act(() => {
      result.current.start();
      vi.advanceTimersByTime(2_000);
      result.current.pause();
    });

    expect(result.current.seconds).toBe(63);
    expect(result.current.isRunning).toBe(false);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.seconds).toBe(63);

    act(() => {
      result.current.reset();
    });
    expect(result.current.seconds).toBe(65);
    expect(result.current.formatted).toBe("1:05");
    expect(result.current.isComplete).toBe(false);
  });

  it("clears its timer when unmounted", () => {
    const onComplete = vi.fn();
    const { result, unmount } = renderHook(() => useCountdown(1, onComplete));

    act(() => {
      result.current.start();
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(onComplete).not.toHaveBeenCalled();
  });
});
