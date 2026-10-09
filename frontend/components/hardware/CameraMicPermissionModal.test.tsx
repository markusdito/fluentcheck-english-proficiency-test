import { StrictMode, type PropsWithChildren } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraMicPermissionModal } from "./CameraMicPermissionModal";
import {
  AssessmentStartContext,
  type AssessmentStartContextValue,
} from "@/components/providers/AssessmentStartProvider";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { clearConsent, readConsent } from "@/lib/consent";

const presence = vi.hoisted(() => ({ detectAudioPresence: vi.fn() }));
vi.mock("@/lib/audio-presence", () => presence);

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

const identityStudent = {
  id: "student-1",
  name: "casey",
  email: "casey@example.test",
  role: "STUDENT" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  fullName: "Casey Putri",
  studentNumber: "2024-001",
};

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  static last: FakeMediaRecorder | null = null;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeMediaRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["clip"], { type: "video/webm" }) });
    this.onstop?.();
  }
}

/** Stub a supported browser: secure context and a working MediaRecorder. */
function installRecorder() {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  URL.createObjectURL = vi.fn(() => "blob:clip");
  URL.revokeObjectURL = vi.fn();
}

async function acceptConsent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "I agree" }));
}

async function recordVoicedClip(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Record Test" }));
  await user.click(await screen.findByRole("button", { name: /^Stop/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start Assessment" })).toBeEnabled());
}

function TestMediaProvider({
  children,
  overrides,
}: PropsWithChildren<{ overrides?: Partial<AssessmentStartContextValue> }>) {
  const media = useMediaDevices();
  const value: AssessmentStartContextValue = {
    ...media,
    studentId: "student-1",
    sessionPending: false,
    sessionError: null,
    student: identityStudent,
    ...overrides,
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
    clearConsent();
    installRecorder();
    presence.detectAudioPresence.mockReset().mockResolvedValue(true);
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

    await acceptConsent(user);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Hardware check needs attention")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await recordVoicedClip(user);
    await user.click(screen.getByRole("button", { name: "Start Assessment" }));

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

  it("requests permissions only after consent, on every open", async () => {
    const user = userEvent.setup();
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
    expect(await screen.findByRole("dialog", { name: "Recording consent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I agree" })).toBeDisabled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(readConsent("student-1")).toBeNull();

    await acceptConsent(user);
    expect(readConsent("student-1")).not.toBeNull();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());

    firstRender.unmount();
    expect(firstCapture.tracks[0].stop).toHaveBeenCalledOnce();

    const secondRender = render(
      <TestMediaProvider>
        <CameraMicPermissionModal {...props} />
      </TestMediaProvider>,
    );
    expect(await screen.findByRole("dialog", { name: "Recording consent" })).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledOnce();
    await acceptConsent(user);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(secondCapture.tracks[0].stop).not.toHaveBeenCalled();
    secondRender.unmount();
  });

  it("requests once after consent under Strict Mode", async () => {
    const user = userEvent.setup();
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

    await acceptConsent(user);
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Record Test" })).toBeEnabled();
    });

    view.unmount();
    expect(capture.tracks[0].stop).toHaveBeenCalledOnce();
    expect(capture.tracks[1].stop).toHaveBeenCalledOnce();
    expect(audio.source.disconnect).toHaveBeenCalledOnce();
    expect(audio.analyser.disconnect).toHaveBeenCalledOnce();
    expect(audio.context.close).toHaveBeenCalledOnce();
  });

  it("keeps Start Assessment disabled until speech is detected in the test clip", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.fn().mockResolvedValue(createStream().stream);
    installMediaDevices(getUserMedia, vi.fn().mockResolvedValue([]));
    installAudioMonitor();
    presence.detectAudioPresence.mockResolvedValueOnce(false);
    const onComplete = vi.fn();

    render(
      <TestMediaProvider>
        <CameraMicPermissionModal open onClose={vi.fn()} onComplete={onComplete} />
      </TestMediaProvider>,
    );
    await acceptConsent(user);
    expect(await screen.findByText(/My name is/)).toHaveTextContent(
      "My name is Casey Putri and my Student ID is 2024-001.",
    );
    const start = screen.getByRole("button", { name: "Start Assessment" });
    expect(start).toBeDisabled();

    await user.click(await screen.findByRole("button", { name: "Record Test" }));
    await user.click(await screen.findByRole("button", { name: /^Stop/ }));
    expect(await screen.findByText(/could not hear your voice/)).toBeInTheDocument();
    expect(screen.getByLabelText("Test clip playback")).toHaveAttribute("src", "blob:clip");
    expect(start).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Record again" }));
    await user.click(await screen.findByRole("button", { name: /^Stop/ }));
    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("asks for full name and Student ID before the test clip when the profile lacks them", async () => {
    const user = userEvent.setup();
    installMediaDevices(vi.fn().mockResolvedValue(createStream().stream), vi.fn().mockResolvedValue([]));
    installAudioMonitor();
    const media = { student: { ...identityStudent, fullName: null, studentNumber: null } };

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TestMediaProvider overrides={media}>
          <CameraMicPermissionModal open onClose={vi.fn()} onComplete={vi.fn()} />
        </TestMediaProvider>
      </QueryClientProvider>,
    );
    await acceptConsent(user);
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Student ID")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Record Test" })).toBeDisabled());
  });

  it("tells an unsupported browser so after consent instead of requesting devices", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("MediaRecorder", undefined);
    const getUserMedia = vi.fn();
    installMediaDevices(getUserMedia, vi.fn().mockResolvedValue([]));

    render(
      <TestMediaProvider>
        <CameraMicPermissionModal open onClose={vi.fn()} onComplete={vi.fn()} />
      </TestMediaProvider>,
    );
    await acceptConsent(user);
    expect(await screen.findByRole("dialog", { name: "Browser not supported" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/latest Chrome/);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
