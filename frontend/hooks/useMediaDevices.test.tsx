import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaDevices } from "./useMediaDevices";

type MediaDevicesMock = Pick<MediaDevices, "enumerateDevices" | "getUserMedia" | "addEventListener" | "removeEventListener">;

function setMediaDevices(mediaDevices: MediaDevicesMock) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices,
  });
}

describe("useMediaDevices", () => {
  let enumerateDevices: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let addEventListener: ReturnType<typeof vi.fn>;
  let removeEventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    enumerateDevices = vi.fn().mockResolvedValue([]);
    getUserMedia = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    setMediaDevices({ enumerateDevices, getUserMedia, addEventListener, removeEventListener });
  });

  it("enumerates available camera and microphone devices on mount", async () => {
    enumerateDevices.mockResolvedValueOnce([
      { deviceId: "camera-1", kind: "videoinput", label: "Front camera" },
      { deviceId: "microphone-1", kind: "audioinput", label: "Desk microphone" },
      { deviceId: "speaker-1", kind: "audiooutput", label: "Desk speakers" },
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
        { deviceId: "camera-2", kind: "videoinput", label: "External camera" },
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
