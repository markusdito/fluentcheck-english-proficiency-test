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

type TestTrack = MediaStreamTrack & {
  end: () => void;
};

function createTrack(kind: "video" | "audio"): TestTrack {
  let readyState: MediaStreamTrackState = "live";
  let endedHandler: (() => void) | undefined;
  const track = {
    kind,
    get readyState() {
      return readyState;
    },
    stop: vi.fn(),
    addEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === "ended") endedHandler = listener;
    }),
    removeEventListener: vi.fn(),
    end: () => {
      readyState = "ended";
      endedHandler?.();
    },
  } as unknown as TestTrack;
  return track;
}

function createStream(tracks: TestTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    addTrack: (track: MediaStreamTrack) => tracks.push(track as TestTrack),
    removeTrack: (track: MediaStreamTrack) => {
      const index = tracks.indexOf(track as TestTrack);
      if (index >= 0) tracks.splice(index, 1);
    },
  } as unknown as MediaStream;
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
  const callbacks = new Map<number, FrameRequestCallback>();
  const requestAnimationFrame = vi
    .fn<(callback: FrameRequestCallback) => number>()
    .mockImplementation((callback) => {
      const id = nextAnimationFrameId++;
      callbacks.set(id, callback);
      return id;
    });
  const cancelAnimationFrame = vi.fn<(handle: number) => void>();
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
  return { requestAnimationFrame, cancelAnimationFrame, callbacks };
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
    const tracks = [createTrack("video"), createTrack("audio")];
    const stream = createStream(tracks);
    getUserMedia.mockResolvedValue(stream);
    const audio = createAudioContextMock();
    installAudioContextMocks(audio);
    const { cancelAnimationFrame } = installAnimationFrameMocks();

    const { result, unmount } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.requestPermissions();
    });

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith("devicechange", expect.any(Function));
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(tracks[1].stop).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(audio.source.disconnect).toHaveBeenCalledOnce();
    expect(audio.analyser.disconnect).toHaveBeenCalledOnce();
    expect(audio.context.close).toHaveBeenCalledOnce();
  });

  it("cleans the previous resource set before replacing it", async () => {
    const firstTracks = [createTrack("video"), createTrack("audio")];
    const secondTracks = [createTrack("video"), createTrack("audio")];
    const firstStream = createStream(firstTracks);
    const secondStream = createStream(secondTracks);
    getUserMedia.mockResolvedValueOnce(firstStream).mockResolvedValueOnce(secondStream);

    const firstAudio = createAudioContextMock();
    const secondAudio = createAudioContextMock();
    installAudioContextMocks(firstAudio, secondAudio);
    const { cancelAnimationFrame, callbacks, requestAnimationFrame } =
      installAnimationFrameMocks();

    const { result } = renderHook(() => useMediaDevices());

    await act(async () => {
      await result.current.requestPermissions();
    });

    await act(async () => {
      await result.current.requestPermissions();
    });

    expect(firstTracks[0].stop).toHaveBeenCalledOnce();
    expect(firstTracks[1].stop).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(firstAudio.source.disconnect).toHaveBeenCalledOnce();
    expect(firstAudio.analyser.disconnect).toHaveBeenCalledOnce();
    expect(firstAudio.context.close).toHaveBeenCalledOnce();
    expect(secondTracks[0].stop).not.toHaveBeenCalled();
    expect(secondTracks[1].stop).not.toHaveBeenCalled();
    expect(result.current.stream).toBe(secondStream);

    callbacks.get(1)?.(0);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent permission requests", async () => {
    const stream = createStream([createTrack("video"), createTrack("audio")]);
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

  it("keeps capture available when optional audio monitoring setup fails", async () => {
    const tracks = [createTrack("video"), createTrack("audio")];
    const stream = createStream(tracks);
    getUserMedia.mockResolvedValue(stream);

    const audio = createAudioContextMock();
    audio.context.createAnalyser.mockImplementation(() => {
      throw new Error("audio graph unavailable");
    });
    installAudioContextMocks(audio);

    const { result } = renderHook(() => useMediaDevices());

    await act(async () => {
      expect(await result.current.requestPermissions()).toBe(true);
    });

    expect(tracks[0].stop).not.toHaveBeenCalled();
    expect(tracks[1].stop).not.toHaveBeenCalled();
    expect(audio.source.disconnect).toHaveBeenCalledOnce();
    expect(audio.analyser.disconnect).not.toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalledOnce();
    expect(result.current.stream).toBe(stream);
    expect(result.current.mediaReady).toBe(true);
    expect(result.current.monitorError).toBe(
      "Microphone level monitoring is unavailable, but microphone capture can continue.",
    );
  });

  it("stops a stream that resolves after the hook unmounts", async () => {
    const permissionRequest = createDeferred<MediaStream>();
    getUserMedia.mockReturnValue(permissionRequest.promise);

    const { result, unmount } = renderHook(() => useMediaDevices());
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.requestPermissions();
    });
    unmount();

    const track = createTrack("video");
    const audioTrack = createTrack("audio");
    const stream = createStream([track, audioTrack]);
    await act(async () => {
      permissionRequest.resolve(stream);
      await request;
    });

    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("does not let a superseded request take ownership from a newer request", async () => {
    const firstRequest = createDeferred<MediaStream>();
    const secondRequest = createDeferred<MediaStream>();
    getUserMedia
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    installAudioContextMocks(createAudioContextMock());
    installAnimationFrameMocks();

    const { result } = renderHook(() => useMediaDevices());
    let firstPermission!: Promise<boolean>;
    act(() => {
      firstPermission = result.current.requestPermissions();
      result.current.stopStream();
    });

    let secondPermission!: Promise<boolean>;
    act(() => {
      secondPermission = result.current.requestPermissions();
    });

    const firstTrack = createTrack("video");
    const firstStream = createStream([firstTrack, createTrack("audio")]);
    await act(async () => {
      firstRequest.resolve(firstStream);
      await firstPermission;
    });

    expect(firstTrack.stop).toHaveBeenCalledOnce();

    const secondStream = createStream([createTrack("video"), createTrack("audio")]);
    await act(async () => {
      secondRequest.resolve(secondStream);
      await secondPermission;
    });

    expect(result.current.stream).toBe(secondStream);
  });

  it("retries only a missing track and preserves the working track", async () => {
    const videoTrack = createTrack("video");
    const firstStream = createStream([videoTrack]);
    const audioTrack = createTrack("audio");
    const secondStream = createStream([audioTrack]);
    getUserMedia.mockResolvedValueOnce(firstStream).mockResolvedValueOnce(secondStream);
    installAudioContextMocks(createAudioContextMock());
    installAnimationFrameMocks();

    const { result } = renderHook(() => useMediaDevices());

    await act(async () => {
      expect(await result.current.requestPermissions()).toBe(false);
    });
    expect(result.current.isVideoReady).toBe(true);
    expect(result.current.isAudioReady).toBe(false);

    await act(async () => {
      expect(await result.current.requestPermissions()).toBe(true);
    });

    expect(getUserMedia).toHaveBeenNthCalledWith(1, { video: true, audio: true });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { video: false, audio: true });
    expect(videoTrack.stop).not.toHaveBeenCalled();
    expect(result.current.stream).toBe(firstStream);
    expect(result.current.mediaReady).toBe(true);
  });

  it("treats live tracks as authoritative even when device enumeration is empty", async () => {
    const stream = createStream([createTrack("video"), createTrack("audio")]);
    getUserMedia.mockResolvedValue(stream);
    installAudioContextMocks(createAudioContextMock());
    installAnimationFrameMocks();

    const { result } = renderHook(() => useMediaDevices());

    await act(async () => {
      expect(await result.current.requestPermissions()).toBe(true);
    });

    expect(result.current.videoDevices).toEqual([]);
    expect(result.current.audioDevices).toEqual([]);
    expect(result.current.mediaReady).toBe(true);
  });

  it("pauses readiness when a capture track ends", async () => {
    const videoTrack = createTrack("video");
    const audioTrack = createTrack("audio");
    const stream = createStream([videoTrack, audioTrack]);
    getUserMedia.mockResolvedValue(stream);
    installAudioContextMocks(createAudioContextMock());
    installAnimationFrameMocks();

    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.requestPermissions();
    });

    act(() => videoTrack.end());

    expect(result.current.isVideoReady).toBe(false);
    expect(result.current.isAudioReady).toBe(true);
    expect(result.current.mediaReady).toBe(false);
    expect(result.current.videoError).toBe("Camera disconnected. Reconnect it and retry.");
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
