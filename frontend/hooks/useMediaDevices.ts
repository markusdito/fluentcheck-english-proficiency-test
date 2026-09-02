"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface AvailableMediaDevice {
  deviceId: string;
  kind: string;
  label: string;
}

export type MediaPermissionTarget = "both" | "camera" | "microphone";

export type MediaDeviceErrorCode =
  | "MEDIA_PERMISSION_DENIED"
  | "MEDIA_DEVICE_MISSING"
  | "MEDIA_DEVICE_BUSY"
  | "MEDIA_UNSUPPORTED"
  | "MEDIA_UNKNOWN";

export interface UseMediaDevicesReturn {
  stream: MediaStream | null;
  videoDevices: AvailableMediaDevice[];
  audioDevices: AvailableMediaDevice[];
  videoError: string | null;
  audioError: string | null;
  videoErrorCode: MediaDeviceErrorCode | null;
  audioErrorCode: MediaDeviceErrorCode | null;
  monitorError: string | null;
  isVideoReady: boolean;
  isAudioReady: boolean;
  mediaReady: boolean;
  isLoading: boolean;
  isMicActive: boolean;
  micLevel: number;
  requestPermissions: (target?: MediaPermissionTarget) => Promise<boolean>;
  stopStream: () => void;
}

type CaptureTrackKind = "video" | "audio";

function hasLiveTrack(stream: MediaStream | null, kind: CaptureTrackKind): boolean {
  if (!stream) return false;
  try {
    return stream.getTracks().some((track) => track.kind === kind && track.readyState !== "ended");
  } catch {
    return false;
  }
}

function classifyMediaError(error: unknown): {
  code: MediaDeviceErrorCode;
  message: string;
} {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      code: "MEDIA_PERMISSION_DENIED",
      message: "Permission denied. Allow camera and microphone access in your browser settings.",
    };
  }
  if (name === "NotFoundError") {
    return {
      code: "MEDIA_DEVICE_MISSING",
      message: "Device not found. Connect the required camera or microphone and retry.",
    };
  }
  if (name === "NotReadableError") {
    return {
      code: "MEDIA_DEVICE_BUSY",
      message: "The device is already in use by another application. Close it and retry.",
    };
  }
  if (
    name === "SecurityError" ||
    name === "TypeError" ||
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    return {
      code: "MEDIA_UNSUPPORTED",
      message: "Camera and microphone access requires a supported browser over HTTPS.",
    };
  }
  return {
    code: "MEDIA_UNKNOWN",
    message: "An unexpected media-device error occurred. Check your devices and retry.",
  };
}

function mergeMediaStreams(
  existingStream: MediaStream,
  additionalStream: MediaStream,
  target: MediaPermissionTarget,
): MediaStream {
  const targetKind: CaptureTrackKind = target === "camera" ? "video" : "audio";
  const existingTracks = existingStream.getTracks();
  const additionalTracks = additionalStream
    .getTracks()
    .filter((track) => track.kind === targetKind && track.readyState !== "ended");

  if (typeof existingStream.removeTrack === "function") {
    for (const track of existingTracks) {
      if (track.kind === targetKind && track.readyState === "ended") {
        existingStream.removeTrack(track);
      }
    }
  }

  if (typeof existingStream.addTrack === "function") {
    for (const track of additionalTracks) existingStream.addTrack(track);
    return existingStream;
  }

  if (typeof MediaStream !== "undefined") {
    return new MediaStream([...existingTracks, ...additionalTracks]);
  }
  return existingStream;
}

function closeAudioContext(audioContext: AudioContext | null) {
  if (!audioContext) return;
  try {
    void Promise.resolve(audioContext.close()).catch(() => undefined);
  } catch {
    // Resource cleanup is best effort when a browser context is already closed.
  }
}

function disconnectAudioNode(node: AudioNode | null) {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // A partially initialized audio graph may already be disconnected.
  }
}

function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Continue releasing the remaining tracks if one track rejects cleanup.
      }
    });
  } catch {
    // A browser may expose a stream whose tracks are no longer readable.
  }
}

function cancelAnimationFrameSafely(handle: number | null) {
  if (handle === null) return;
  try {
    cancelAnimationFrame(handle);
  } catch {
    // A browser may reject a handle that was already canceled.
  }
}

interface MonitorResources {
  audioContext: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  animationFrame: number | null;
}

function releaseMonitorResources({
  audioContext,
  source,
  analyser,
  animationFrame,
}: MonitorResources) {
  cancelAnimationFrameSafely(animationFrame);
  disconnectAudioNode(source);
  disconnectAudioNode(analyser);
  closeAudioContext(audioContext);
}

export function useMediaDevices(): UseMediaDevicesReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = useState<AvailableMediaDevice[]>([]);
  const [audioDevices, setAudioDevices] = useState<AvailableMediaDevice[]>([]);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [videoErrorCode, setVideoErrorCode] = useState<MediaDeviceErrorCode | null>(null);
  const [audioErrorCode, setAudioErrorCode] = useState<MediaDeviceErrorCode | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const monitorTokenRef = useRef<object | null>(null);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const inFlightRequestRef = useRef<Promise<boolean> | null>(null);
  const stoppedStreamsRef = useRef(new WeakSet<MediaStream>());
  const trackCleanupRef = useRef<Array<() => void>>([]);

  const stopOwnedStream = useCallback((mediaStream: MediaStream | null) => {
    if (!mediaStream || stoppedStreamsRef.current.has(mediaStream)) return;
    stoppedStreamsRef.current.add(mediaStream);
    stopMediaStream(mediaStream);
  }, []);

  const detachTrackListeners = useCallback(() => {
    for (const cleanup of trackCleanupRef.current) cleanup();
    trackCleanupRef.current = [];
  }, []);

  const refreshTrackReadiness = useCallback((mediaStream: MediaStream | null) => {
    const videoReady = hasLiveTrack(mediaStream, "video");
    const audioReady = hasLiveTrack(mediaStream, "audio");
    setIsVideoReady(videoReady);
    setIsAudioReady(audioReady);
    setMediaReady(videoReady && audioReady);
    return { videoReady, audioReady };
  }, []);

  const attachTrackListeners = useCallback(
    (mediaStream: MediaStream) => {
      detachTrackListeners();
      for (const track of mediaStream.getTracks()) {
        if (!track.addEventListener) continue;
        const handleEnded = () => {
          refreshTrackReadiness(mediaStream);
          if (track.kind === "videoinput" || track.kind === "video") {
            setVideoErrorCode("MEDIA_DEVICE_MISSING");
            setVideoError("Camera disconnected. Reconnect it and retry.");
          }
          if (track.kind === "audioinput" || track.kind === "audio") {
            setAudioErrorCode("MEDIA_DEVICE_MISSING");
            setAudioError("Microphone disconnected. Reconnect it and retry.");
          }
        };
        track.addEventListener("ended", handleEnded);
        trackCleanupRef.current.push(() => track.removeEventListener("ended", handleEnded));
      }
      return refreshTrackReadiness(mediaStream);
    }, [detachTrackListeners, refreshTrackReadiness],
  );

  /** Enumerate all media devices */
  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(
        devices
          .filter((d) => d.kind === "videoinput")
          .map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label })),
      );
      setAudioDevices(
        devices
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label })),
      );
    } catch {
      // Silently fail — permissions may not be granted yet
    }
  }, []);

  /** Start optional mic level monitoring via AnalyserNode. */
  const startMicMonitor = useCallback((mediaStream: MediaStream): string | null => {
    const monitorToken = {};
    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;

    try {
      audioContext = new AudioContext();
      source = audioContext.createMediaStreamSource(mediaStream);
      const createdAnalyser = audioContext.createAnalyser();
      analyser = createdAnalyser;
      createdAnalyser.fftSize = 1024;
      createdAnalyser.smoothingTimeConstant = 0.8; // Smooth out jitter, behave like browser meter
      source.connect(createdAnalyser);
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      analyserRef.current = createdAnalyser;
      monitorTokenRef.current = monitorToken;

      const bufferLength = createdAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const tick = () => {
        if (monitorTokenRef.current !== monitorToken) return;
        createdAnalyser.getByteTimeDomainData(dataArray);
        // Time-domain: values range 0-255, where 128 = silence.
        // Compute RMS deviation from 128 to get actual audio amplitude.
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          const deviation = dataArray[i] - 128;
          sumSquares += deviation * deviation;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);
        // RMS max is ~128 (peak-to-peak / 2). Map to 0-100 with a sensitivity multiplier
        // to match browser-native mic level sensitivity.
        const rawPercent = (rms / 128) * 100;
        // Apply non-linear boost: browser meters are more sensitive at low volumes
        const boosted = rawPercent * 2.5;
        const clamped = Math.min(100, Math.round(boosted));

        setIsMicActive(clamped > 2);
        setMicLevel(clamped);
        animationRef.current = requestAnimationFrame(tick);
      };
      tick();
      return null;
    } catch {
      if (monitorTokenRef.current === monitorToken) {
        monitorTokenRef.current = null;
      }
      releaseMonitorResources({
        audioContext,
        source,
        analyser,
        animationFrame: animationRef.current,
      });
      animationRef.current = null;
      if (sourceRef.current === source) {
        sourceRef.current = null;
      }
      if (analyserRef.current === analyser) {
        analyserRef.current = null;
      }
      if (audioContextRef.current === audioContext) {
        audioContextRef.current = null;
      }
      return "Microphone level monitoring is unavailable, but microphone capture can continue.";
    }
  }, []);

  /** Stop mic monitoring and release every resource it owns. */
  const stopMicMonitor = useCallback((resetState = true) => {
    monitorTokenRef.current = null;
    releaseMonitorResources({
      audioContext: audioContextRef.current,
      source: sourceRef.current,
      analyser: analyserRef.current,
      animationFrame: animationRef.current,
    });
    animationRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    audioContextRef.current = null;
    if (resetState) {
      setIsMicActive(false);
      setMicLevel(0);
      setMonitorError(null);
    }
  }, []);

  const cleanupMediaResources = useCallback(
    (resetState = true) => {
      stopMicMonitor(resetState);
      detachTrackListeners();
      const currentStream = streamRef.current;
      if (currentStream) {
        stopOwnedStream(currentStream);
        streamRef.current = null;
      }
      if (resetState) {
        setStream(null);
        setIsVideoReady(false);
        setIsAudioReady(false);
        setMediaReady(false);
        setIsLoading(false);
        setVideoErrorCode(null);
        setAudioErrorCode(null);
        setMonitorError(null);
      }
    },
    [detachTrackListeners, stopMicMonitor, stopOwnedStream],
  );

  /** Request only the missing capture devices unless an explicit target is given. */
  const requestPermissions = useCallback((requestedTarget?: MediaPermissionTarget): Promise<boolean> => {
    const inFlightRequest = inFlightRequestRef.current;
    if (inFlightRequest) return inFlightRequest;
    if (!mountedRef.current) return Promise.resolve(false);

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const isCurrentRequest = () =>
      mountedRef.current && requestIdRef.current === requestId;

    const request = (async (): Promise<boolean> => {
      const existingStream = streamRef.current;
      const target = requestedTarget ?? (
        hasLiveTrack(existingStream, "video") && hasLiveTrack(existingStream, "audio")
          ? "both"
          : hasLiveTrack(existingStream, "video")
            ? "microphone"
            : hasLiveTrack(existingStream, "audio")
              ? "camera"
              : "both"
      );
      const wantsVideo = target === "both" || target === "camera";
      const wantsAudio = target === "both" || target === "microphone";
      const preserveExistingStream = existingStream !== null && target !== "both";

      if (!preserveExistingStream) cleanupMediaResources();
      else stopMicMonitor();
      setIsLoading(true);
      if (wantsVideo) {
        setVideoError(null);
        setVideoErrorCode(null);
      }
      if (wantsAudio) {
        setAudioError(null);
        setAudioErrorCode(null);
      }

      let mediaStream: MediaStream | null = null;
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException("Media devices are unavailable", "NotSupportedError");
        }
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: wantsVideo,
          audio: wantsAudio,
        });

        if (!isCurrentRequest()) {
          stopOwnedStream(mediaStream);
          return false;
        }

        const ownedStream = preserveExistingStream && existingStream
          ? mergeMediaStreams(existingStream, mediaStream, target)
          : mediaStream;
        if (ownedStream !== mediaStream) {
          mediaStream = null;
        }
        streamRef.current = ownedStream;
        setStream(ownedStream);
        attachTrackListeners(ownedStream);
        await enumerateDevices();

        if (!isCurrentRequest()) {
          if (streamRef.current === ownedStream && ownedStream !== existingStream) {
            cleanupMediaResources(false);
          } else {
            stopOwnedStream(mediaStream);
          }
          return false;
        }

        if (hasLiveTrack(ownedStream, "audio")) {
          const monitorFailure = startMicMonitor(ownedStream);
          setMonitorError(monitorFailure);
        }

        if (!isCurrentRequest()) {
          if (streamRef.current === ownedStream && ownedStream !== existingStream) {
            cleanupMediaResources(false);
          } else {
            stopOwnedStream(mediaStream);
          }
          return false;
        }

        const readiness = refreshTrackReadiness(ownedStream);
        setIsLoading(false);
        return readiness.videoReady && readiness.audioReady;
      } catch (err: unknown) {
        if (!isCurrentRequest()) {
          if (streamRef.current === mediaStream) {
            cleanupMediaResources(false);
          } else {
            stopOwnedStream(mediaStream);
          }
          return false;
        }

        if (mediaStream && mediaStream !== streamRef.current) {
          stopOwnedStream(mediaStream);
        }
        if (!preserveExistingStream) {
          streamRef.current = null;
          setStream(null);
          setIsVideoReady(false);
          setIsAudioReady(false);
          setMediaReady(false);
        } else if (streamRef.current) {
          refreshTrackReadiness(streamRef.current);
        }

        const failure = classifyMediaError(err);
        if (wantsVideo) {
          setVideoErrorCode(failure.code);
          setVideoError(failure.message);
        }
        if (wantsAudio) {
          setAudioErrorCode(failure.code);
          setAudioError(failure.message);
        }

        setIsLoading(false);
        return false;
      }
    })();

    inFlightRequestRef.current = request;
    void request.then(
      () => {
        if (inFlightRequestRef.current === request) {
          inFlightRequestRef.current = null;
        }
      },
      () => {
        if (inFlightRequestRef.current === request) {
          inFlightRequestRef.current = null;
        }
      },
    );
    return request;
  }, [
    attachTrackListeners,
    cleanupMediaResources,
    enumerateDevices,
    refreshTrackReadiness,
    startMicMonitor,
    stopMicMonitor,
    stopOwnedStream,
  ]);

  /** Stop all tracks and clean up — uses ref to avoid recreating on stream state change */
  const stopStream = useCallback(() => {
    requestIdRef.current += 1;
    inFlightRequestRef.current = null;
    cleanupMediaResources();
  }, [cleanupMediaResources]);

  /** Enumerate devices on mount in case permissions already granted */
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void enumerateDevices();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [enumerateDevices]);

  /** Listen for device changes */
  useEffect(() => {
    const handleDeviceChange = () => {
      enumerateDevices();
    };
    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [enumerateDevices]);

  /** Cleanup on unmount — uses ref to avoid recreating on stream state change */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupMediaResources(false);
    };
  }, [cleanupMediaResources]);

  return {
    stream,
    videoDevices,
    audioDevices,
    videoError,
    audioError,
    videoErrorCode,
    audioErrorCode,
    monitorError,
    isVideoReady,
    isAudioReady,
    mediaReady,
    isLoading,
    isMicActive,
    micLevel,
    requestPermissions,
    stopStream,
  };
}
