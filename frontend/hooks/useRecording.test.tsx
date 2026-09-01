import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecording } from "./useRecording";

type RecorderCallback = ((event: { data: Blob }) => void) | null;

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((mimeType: string) => mimeType === "video/webm;codecs=vp9,opus");

  readonly stream: MediaStream;
  readonly options: MediaRecorderOptions;
  state: RecordingState = "inactive";
  ondataavailable: RecorderCallback = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly start = vi.fn(() => {
    this.state = "recording";
  });
  readonly stop = vi.fn(() => {
    this.state = "inactive";
  });

  constructor(stream: MediaStream, options: MediaRecorderOptions) {
    this.stream = stream;
    this.options = options;
    FakeMediaRecorder.instances.push(this);
  }

  emitChunk(blob: Blob) {
    this.ondataavailable?.({ data: blob });
  }

  emitStop() {
    this.onstop?.();
  }

  emitError() {
    this.onerror?.();
  }
}

type RecordingState = "inactive" | "recording";

function streamFixture() {
  return { getTracks: () => [] } as unknown as MediaStream;
}

describe("useRecording", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.isTypeSupported = vi.fn(
      (mimeType: string) => mimeType === "video/webm;codecs=vp9,opus",
    );
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps manual stop in finalizing until MediaRecorder produces a non-empty blob", () => {
    const { result } = renderHook(() => useRecording());

    act(() => result.current.startRecording(streamFixture(), 5));
    const recorder = FakeMediaRecorder.instances[0]!;
    expect(result.current.state).toBe("recording");
    expect(recorder.options).toEqual({ mimeType: "video/webm;codecs=vp9,opus" });

    act(() => {
      vi.advanceTimersByTime(2_000);
      result.current.stopRecording();
    });
    expect(result.current.state).toBe("finalizing");
    expect(result.current.blob).toBeNull();
    expect(recorder.stop).toHaveBeenCalledOnce();

    act(() => {
      recorder.emitChunk(new Blob(["video"], { type: "video/webm" }));
      recorder.emitStop();
    });

    expect(result.current.state).toBe("blob-ready");
    expect(result.current.blob).toEqual(expect.any(Blob));
    expect(result.current.blob?.size).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.duration).toBe(2);
  });

  it("rejects empty recordings and exposes recorder failures without a fake blob", () => {
    const { result } = renderHook(() => useRecording());
    act(() => result.current.startRecording(streamFixture()));
    const recorder = FakeMediaRecorder.instances[0]!;

    act(() => {
      result.current.stopRecording();
      recorder.emitStop();
    });
    expect(result.current.state).toBe("error");
    expect(result.current.blob).toBeNull();
    expect(result.current.error).toBe("Recording produced an empty video. Please try again.");

    act(() => result.current.resetRecording());
    act(() => result.current.startRecording(streamFixture()));
    const failedRecorder = FakeMediaRecorder.instances[1]!;
    act(() => failedRecorder.emitError());
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("Recording failed due to an internal error.");
  });

  it("automatically stops at the configured duration and falls back to plain WebM", () => {
    FakeMediaRecorder.isTypeSupported.mockReturnValue(false);
    const { result } = renderHook(() => useRecording());

    act(() => result.current.startRecording(streamFixture(), 2));
    const recorder = FakeMediaRecorder.instances[0]!;
    expect(recorder.options).toEqual({ mimeType: "video/webm" });

    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current.duration).toBe(2);
    expect(result.current.state).toBe("finalizing");
    expect(recorder.stop).toHaveBeenCalledOnce();
  });

  it("cleans the interval and ignores a late stop callback after reset or unmount", () => {
    const { result, unmount } = renderHook(() => useRecording());
    act(() => result.current.startRecording(streamFixture()));
    const recorder = FakeMediaRecorder.instances[0]!;
    act(() => result.current.stopRecording());
    act(() => result.current.resetRecording());

    act(() => {
      recorder.emitChunk(new Blob(["late"]));
      recorder.emitStop();
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.blob).toBeNull();
    expect(result.current.duration).toBe(0);

    act(() => result.current.startRecording(streamFixture()));
    const secondRecorder = FakeMediaRecorder.instances[1]!;
    unmount();
    expect(secondRecorder.stop).toHaveBeenCalledOnce();
    act(() => {
      secondRecorder.emitChunk(new Blob(["late-after-unmount"]));
      secondRecorder.emitStop();
      vi.advanceTimersByTime(2_000);
    });
  });
});
