import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaDevices } from "./useMediaDevices";

type MediaDevicesMock = Pick<
  MediaDevices,
  "enumerateDevices" | "getUserMedia" | "addEventListener" | "removeEventListener"
>;

function setMediaDevices(mediaDevices: MediaDevicesMock) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices,
  });
}

function createDevice(deviceId: string, kind: MediaDeviceKind, label: string): MediaDeviceInfo {
  return { deviceId, groupId: "", kind, label, toJSON: () => ({}) };
}

function createAudioContextMock() {
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 1,
    getByteTimeDomainData: vi.fn((data: Uint8Array) => data.fill(128)),
    disconnect: vi.fn(),
  };
  const context = {
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    close: vi.fn().mockResolvedValue(undefined),
    state: "running",
  };

  return { context, source, analyser };
}

function installAudioContextMocks(
  ...audioContextMocks: ReturnType<typeof createAudioContextMock>[]
) {
  const contexts = [...audioContextMocks];
  const audioContexts = vi.fn<() => AudioContext>(function () {
    const next = contexts.shift();
    if (!next) throw new Error("Unexpected AudioContext construction");
    return next.context as unknown as AudioContext;
  });
  vi.stubGlobal("AudioContext", audioContexts);
  return audioContexts;
}

function installAnimationFrameMocks() {
  let nextAnimationFrameId = 1;
  const requestAnimationFrame = vi
    .fn<(callback: FrameRequestCallback) => number>()
    .mockImplementation(() => nextAnimationFrameId++);
  const cancelAnimationFrame = vi.fn<(handle: number) => void>();
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
  return { requestAnimationFrame, cancelAnimationFrame };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("useMediaDevices", () => {
  let enumerateDevices: ReturnType<typeof vi.fn<MediaDevices["enumerateDevices"]>>;
  let getUserMedia: ReturnType<typeof vi.fn<MediaDevices["getUserMedia"]>>;
  let addEventListener: ReturnType<typeof vi.fn<MediaDevices["addEventListener"]>>;
  let removeEventListener: ReturnType<typeof vi.fn<MediaDevices["removeEventListener"]>>;

  beforeEach(() => {
    enumerateDevices = vi.fn<MediaDevices["enumerateDevices"]>().mockResolvedValue([]);
    getUserMedia = vi.fn<MediaDevices["getUserMedia"]>();
    addEventListener = vi.fn<MediaDevices["addEventListener"]>();
    removeEventListener = vi.fn<MediaDevices["removeEventListener"]>();
    setMediaDevices({ enumerateDevices, getUserMedia, addEventListener, removeEventListener });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enumerates available camera and microphone devices on mount", async () => {
    enumerateDevices.mockResolvedValueOnce([
      createDevice("camera-1", "videoinput", "Front camera"),
      createDevice("microphone-1", "audioinput", "Desk microphone"),
      createDevice("speaker-1", "audiooutput", "Desk speakers"),
    ]);

    const { result } = renderHook(() => useMediaDevices());

    await waitFor(() => {
      expect(result.current.videoDevices).toEqual([
        { deviceId: "camera-1", kind: "videoinput", label: "Front camera" },
      ]);
      expect(result.current.audioDevices).toEqual([
        { deviceId: "microphone-1", kind: "audioinput", label: "Desk microphone" },
      ]);
    });
  });

  it("re-enumerates devices when the browser reports a device change", async () => {
    enumerateDevices
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createDevice("camera-2", "videoinput", "External camera"),
      ]);

    const { result } = renderHook(() => useMediaDevices());
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));

    const deviceChangeHandler = addEventListener.mock.calls[0][1] as () => void;
    act(() => deviceChangeHandler());

    await waitFor(() => {
      expect(result.current.videoDevices).toEqual([
        { deviceId: "camera-2", kind: "videoinput", label: "External camera" },
      ]);
    });
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
  });

  it("removes the device listener and stops the active stream on unmount", async () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    getUserMedia.mockResolvedValue(stream);

    const { result, unmount } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.requestPermissions();
    });

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith("devicechange", expect.any(Function));
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(tracks[1].stop).toHaveBeenCalledOnce();
  });

  it("cleans the previous resource set before replacing it", async () => {
    const firstTrack = { stop: vi.fn() };
    const secondTrack = { stop: vi.fn() };
    const firstStream = {
      getTracks: () => [firstTrack],
    } as unknown as MediaStream;
    const secondStream = {
      getTracks: () => [secondTrack],
    } as unknown as MediaStream;
    getUserMedia.mockResolvedValueOnce(firstStream).mockResolvedValueOnce(secondStream);

    const firstAudio = createAudioContextMock();
    const secondAudio = createAudioContextMock();
    installAudioContextMocks(firstAudio, secondAudio);
    const { cancelAnimationFrame } = installAnimationFrameMocks();

    const { result } = renderHook(() => useMediaDevices());

    await act(async () => {
      await result.current.requestPermissions();
    });

    await act(async () => {
      await result.current.requestPermissions();
    });

    expect(firstTrack.stop).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(firstAudio.source.disconnect).toHaveBeenCalledOnce();
    expect(firstAudio.analyser.disconnect).toHaveBeenCalledOnce();
    expect(firstAudio.context.close).toHaveBeenCalledOnce();
    expect(secondTrack.stop).not.toHaveBeenCalled();
    expect(result.current.stream).toBe(secondStream);
  });

  it("deduplicates concurrent permission requests", async () => {
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    const permissionRequest = createDeferred<MediaStream>();
    getUserMedia.mockReturnValue(permissionRequest.promise);
    installAudioContextMocks(createAudioContextMock());
    installAnimationFrameMocks();

    const { result } = renderHook(() => useMediaDevices());
    let firstRequest!: Promise<boolean>;
    let secondRequest!: Promise<boolean>;

    act(() => {
      firstRequest = result.current.requestPermissions();
      secondRequest = result.current.requestPermissions();
    });

    expect(firstRequest).toBe(secondRequest);
    expect(getUserMedia).toHaveBeenCalledOnce();

    await act(async () => {
      permissionRequest.resolve(stream);
      await firstRequest;
    });

    expect(result.current.stream).toBe(stream);
  });

  it("cancels deferred device enumeration when unmounted", () => {
    vi.useFakeTimers();

    try {
      const { unmount } = renderHook(() => useMediaDevices());
      unmount();
      vi.runAllTimers();

      expect(enumerateDevices).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
