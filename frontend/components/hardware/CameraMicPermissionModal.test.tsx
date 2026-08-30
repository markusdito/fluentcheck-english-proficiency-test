import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraMicPermissionModal } from "./CameraMicPermissionModal";

const originalMediaDevices = navigator.mediaDevices;

function installMediaDevices(
  getUserMedia: ReturnType<typeof vi.fn>,
  enumerateDevices: ReturnType<typeof vi.fn>,
) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

function installAudioMonitor() {
  const source = { connect: vi.fn(), disconnect: vi.fn() };
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
  const audioContexts = vi.fn<() => AudioContext>(function () {
    return context as unknown as AudioContext;
  });

  vi.stubGlobal("AudioContext", audioContexts);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

describe("CameraMicPermissionModal", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lets a student retry denied permissions and continue after both devices are found", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const enumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: "camera-1", kind: "videoinput", label: "Front camera" },
      { deviceId: "microphone-1", kind: "audioinput", label: "Desk microphone" },
    ]);
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    getUserMedia.mockResolvedValueOnce(stream);
    const onClose = vi.fn();
    const onComplete = vi.fn();
    installMediaDevices(getUserMedia, enumerateDevices);
    installAudioMonitor();

    render(
      <CameraMicPermissionModal
        open
        onClose={onClose}
        onComplete={onComplete}
      />,
    );

    expect(await screen.findByText("Permission issues detected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("requests permissions again after the modal is remounted", async () => {
    const getUserMedia = vi.fn();
    const enumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: "camera-1", kind: "videoinput", label: "Front camera" },
      { deviceId: "microphone-1", kind: "audioinput", label: "Desk microphone" },
    ]);
    const firstTrack = { stop: vi.fn() };
    const secondTrack = { stop: vi.fn() };
    getUserMedia
      .mockResolvedValueOnce({ getTracks: () => [firstTrack] } as unknown as MediaStream)
      .mockResolvedValueOnce({ getTracks: () => [secondTrack] } as unknown as MediaStream);
    installMediaDevices(getUserMedia, enumerateDevices);
    installAudioMonitor();

    const props = { open: true, onClose: vi.fn(), onComplete: vi.fn() };
    const firstRender = render(<CameraMicPermissionModal {...props} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());

    firstRender.unmount();
    expect(firstTrack.stop).toHaveBeenCalledOnce();

    render(<CameraMicPermissionModal {...props} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(secondTrack.stop).not.toHaveBeenCalled();
  });

  it("retains the permission result through Strict Mode effect replay", async () => {
    const getUserMedia = vi.fn();
    const enumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: "camera-1", kind: "videoinput", label: "Front camera" },
      { deviceId: "microphone-1", kind: "audioinput", label: "Desk microphone" },
    ]);
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    getUserMedia.mockResolvedValue(stream);
    installMediaDevices(getUserMedia, enumerateDevices);
    installAudioMonitor();

    render(
      <StrictMode>
        <CameraMicPermissionModal
          open
          onClose={vi.fn()}
          onComplete={vi.fn()}
        />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    });
  });

  it("releases media when the modal closes through its open prop", async () => {
    const getUserMedia = vi.fn();
    const enumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: "camera-1", kind: "videoinput", label: "Front camera" },
      { deviceId: "microphone-1", kind: "audioinput", label: "Desk microphone" },
    ]);
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    getUserMedia.mockResolvedValue(stream);
    installMediaDevices(getUserMedia, enumerateDevices);
    installAudioMonitor();

    const props = { open: true, onClose: vi.fn(), onComplete: vi.fn() };
    const view = render(<CameraMicPermissionModal {...props} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    });

    view.rerender(<CameraMicPermissionModal {...props} open={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
