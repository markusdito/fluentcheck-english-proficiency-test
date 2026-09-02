import { StrictMode, type PropsWithChildren } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraMicPermissionModal } from "./CameraMicPermissionModal";
import {
  AssessmentStartContext,
  type AssessmentStartContextValue,
} from "@/components/providers/AssessmentStartProvider";
import { useMediaDevices } from "@/hooks/useMediaDevices";

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
  const cancelAnimationFrame = vi.fn();

  vi.stubGlobal("AudioContext", audioContexts);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

  return { source, analyser, context, cancelAnimationFrame };
}

function createTrack(kind: "video" | "audio") {
  return {
    kind,
    readyState: "live",
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function createStream() {
  const tracks = [createTrack("video"), createTrack("audio")];
  return {
    stream: {
      getTracks: () => tracks,
      addTrack: (track: MediaStreamTrack) => tracks.push(track),
      removeTrack: (track: MediaStreamTrack) => {
        const index = tracks.indexOf(track);
        if (index >= 0) tracks.splice(index, 1);
      },
    } as unknown as MediaStream,
    tracks,
  };
}

function TestMediaProvider({ children }: PropsWithChildren) {
  const media = useMediaDevices();
  const value: AssessmentStartContextValue = {
    ...media,
    studentId: "student-1",
    sessionPending: false,
    sessionError: null,
    student: null,
  };
  return (
    <AssessmentStartContext.Provider value={value}>
      {children}
    </AssessmentStartContext.Provider>
  );
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
    const capture = createStream();
    getUserMedia.mockResolvedValueOnce(capture.stream);
    const onClose = vi.fn();
    const onComplete = vi.fn();
    installMediaDevices(getUserMedia, enumerateDevices);
    const audio = installAudioMonitor();

    const view = render(
      <TestMediaProvider>
        <CameraMicPermissionModal
          open
          onClose={onClose}
          onComplete={onComplete}
        />
      </TestMediaProvider>,
    );

    expect(getUserMedia).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Enable camera and microphone" }));
    expect(await screen.findByText("Hardware check needs attention")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(capture.tracks[0].stop).not.toHaveBeenCalled();
    expect(capture.tracks[1].stop).not.toHaveBeenCalled();
    expect(audio.source.disconnect).not.toHaveBeenCalled();
    expect(audio.analyser.disconnect).not.toHaveBeenCalled();
    expect(audio.context.close).not.toHaveBeenCalled();

    view.unmount();
    expect(capture.tracks[0].stop).toHaveBeenCalledOnce();
    expect(capture.tracks[1].stop).toHaveBeenCalledOnce();
    expect(audio.source.disconnect).toHaveBeenCalledOnce();
    expect(audio.analyser.disconnect).toHaveBeenCalledOnce();
    expect(audio.context.close).toHaveBeenCalledOnce();
  });

  it("does not request permissions until the student explicitly enables them", async () => {
    const getUserMedia = vi.fn();
    const enumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: "camera-1", kind: "videoinput", label: "Front camera" },
      { deviceId: "microphone-1", kind: "audioinput", label: "Desk microphone" },
    ]);
    const firstCapture = createStream();
    const secondCapture = createStream();
    getUserMedia
      .mockResolvedValueOnce(firstCapture.stream)
      .mockResolvedValueOnce(secondCapture.stream);
    installMediaDevices(getUserMedia, enumerateDevices);
    installAudioMonitor();

    const props = { open: true, onClose: vi.fn(), onComplete: vi.fn() };
    const firstRender = render(
      <TestMediaProvider>
        <CameraMicPermissionModal {...props} />
      </TestMediaProvider>,
    );
    expect(getUserMedia).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Enable camera and microphone" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());

    firstRender.unmount();
    expect(firstCapture.tracks[0].stop).toHaveBeenCalledOnce();

    const secondRender = render(
      <TestMediaProvider>
        <CameraMicPermissionModal {...props} />
      </TestMediaProvider>,
    );
    expect(getUserMedia).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Enable camera and microphone" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(secondCapture.tracks[0].stop).not.toHaveBeenCalled();
    secondRender.unmount();
  });

  it("requests once after an explicit click under Strict Mode", async () => {
    const getUserMedia = vi.fn();
    const enumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: "camera-1", kind: "videoinput", label: "Front camera" },
      { deviceId: "microphone-1", kind: "audioinput", label: "Desk microphone" },
    ]);
    const capture = createStream();
    getUserMedia.mockResolvedValue(capture.stream);
    installMediaDevices(getUserMedia, enumerateDevices);
    const audio = installAudioMonitor();

    const view = render(
      <StrictMode>
        <TestMediaProvider>
          <CameraMicPermissionModal
            open
            onClose={vi.fn()}
            onComplete={vi.fn()}
          />
        </TestMediaProvider>
      </StrictMode>,
    );

    expect(getUserMedia).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Enable camera and microphone" }));
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    });

    view.unmount();
    expect(capture.tracks[0].stop).toHaveBeenCalledOnce();
    expect(capture.tracks[1].stop).toHaveBeenCalledOnce();
    expect(audio.source.disconnect).toHaveBeenCalledOnce();
    expect(audio.analyser.disconnect).toHaveBeenCalledOnce();
    expect(audio.context.close).toHaveBeenCalledOnce();
  });

  it("preserves the stream when Continue closes the modal", async () => {
    const getUserMedia = vi.fn();
    const enumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: "camera-1", kind: "videoinput", label: "Front camera" },
      { deviceId: "microphone-1", kind: "audioinput", label: "Desk microphone" },
    ]);
    const capture = createStream();
    getUserMedia.mockResolvedValueOnce(capture.stream);
    installMediaDevices(getUserMedia, enumerateDevices);
    installAudioMonitor();

    const props = { open: true, onClose: vi.fn(), onComplete: vi.fn() };
    const view = render(
      <TestMediaProvider>
        <CameraMicPermissionModal {...props} />
      </TestMediaProvider>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Enable camera and microphone" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    });

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(props.onComplete).toHaveBeenCalledOnce();
    expect(capture.tracks[0].stop).not.toHaveBeenCalled();
    expect(capture.tracks[1].stop).not.toHaveBeenCalled();

    view.rerender(
      <TestMediaProvider>
        <CameraMicPermissionModal {...props} open={false} />
      </TestMediaProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(capture.tracks[0].stop).not.toHaveBeenCalled();
    view.unmount();
    expect(capture.tracks[0].stop).toHaveBeenCalledOnce();
  });
});
