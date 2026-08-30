import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
