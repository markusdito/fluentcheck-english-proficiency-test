"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface MediaDeviceInfo {
  deviceId: string;
  kind: string;
  label: string;
}

interface UseMediaDevicesReturn {
  stream: MediaStream | null;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  videoError: string | null;
  audioError: string | null;
  isLoading: boolean;
  isMicActive: boolean;
  micLevel: number;
  requestPermissions: () => Promise<boolean>;
  stopStream: () => void;
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

export function useMediaDevices(): UseMediaDevicesReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
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

  const stopOwnedStream = useCallback((mediaStream: MediaStream | null) => {
    if (!mediaStream || stoppedStreamsRef.current.has(mediaStream)) return;
    stoppedStreamsRef.current.add(mediaStream);
    stopMediaStream(mediaStream);
  }, []);

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

  /** Start mic level monitoring via AnalyserNode */
  const startMicMonitor = useCallback((mediaStream: MediaStream) => {
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
    } catch (error) {
      if (monitorTokenRef.current === monitorToken) {
        monitorTokenRef.current = null;
      }
      if (animationRef.current !== null) {
        cancelAnimationFrameSafely(animationRef.current);
        animationRef.current = null;
      }
      if (sourceRef.current === source) {
        sourceRef.current = null;
      }
      if (analyserRef.current === analyser) {
        analyserRef.current = null;
      }
      if (audioContextRef.current === audioContext) {
        audioContextRef.current = null;
      }
      disconnectAudioNode(source);
      disconnectAudioNode(analyser);
      closeAudioContext(audioContext);
      throw error;
    }
  }, []);

  /** Stop mic monitoring and release every resource it owns. */
  const stopMicMonitor = useCallback((resetState = true) => {
    monitorTokenRef.current = null;
    if (animationRef.current !== null) {
      cancelAnimationFrameSafely(animationRef.current);
      animationRef.current = null;
    }
    disconnectAudioNode(sourceRef.current);
    sourceRef.current = null;
    disconnectAudioNode(analyserRef.current);
    analyserRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    closeAudioContext(audioContext);
    if (resetState) {
      setIsMicActive(false);
      setMicLevel(0);
    }
  }, []);

  const cleanupMediaResources = useCallback(
    (resetState = true) => {
      stopMicMonitor(resetState);
      const currentStream = streamRef.current;
      if (currentStream) {
        stopOwnedStream(currentStream);
        streamRef.current = null;
      }
      if (resetState) {
        setStream(null);
        setIsLoading(false);
      }
    },
    [stopMicMonitor, stopOwnedStream],
  );

  /** Request camera + mic permissions */
  const requestPermissions = useCallback((): Promise<boolean> => {
    const inFlightRequest = inFlightRequestRef.current;
    if (inFlightRequest) return inFlightRequest;
    if (!mountedRef.current) return Promise.resolve(false);

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const isCurrentRequest = () =>
      mountedRef.current && requestIdRef.current === requestId;

    const request = (async (): Promise<boolean> => {
      cleanupMediaResources();
      setIsLoading(true);
      setVideoError(null);
      setAudioError(null);

      let mediaStream: MediaStream | null = null;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!isCurrentRequest()) {
          stopOwnedStream(mediaStream);
          return false;
        }

        streamRef.current = mediaStream;
        setStream(mediaStream);
        await enumerateDevices();

        if (!isCurrentRequest()) {
          if (streamRef.current === mediaStream) cleanupMediaResources(false);
          return false;
        }

        startMicMonitor(mediaStream);

        if (!isCurrentRequest()) {
          if (streamRef.current === mediaStream) cleanupMediaResources(false);
          return false;
        }

        setIsLoading(false);
        return true;
      } catch (err: unknown) {
        if (!isCurrentRequest()) {
          if (streamRef.current === mediaStream) {
            cleanupMediaResources(false);
          } else {
            stopOwnedStream(mediaStream);
          }
          return false;
        }

        cleanupMediaResources();

        if (err instanceof DOMException) {
          if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            setVideoError("Permission denied. Please allow camera and microphone access in your browser settings.");
            setAudioError("Permission denied. Please allow camera and microphone access in your browser settings.");
          } else if (err.name === "NotFoundError") {
            setVideoError("No camera found. Please connect a webcam.");
            setAudioError("No microphone found. Please connect a microphone.");
          } else if (err.name === "NotReadableError") {
            setVideoError("Camera is already in use by another application.");
            setAudioError("Microphone is already in use by another application.");
          } else {
            setVideoError(`Camera error: ${err.message}`);
            setAudioError(`Microphone error: ${err.message}`);
          }
        } else {
          setVideoError("An unexpected error occurred while accessing media devices.");
          setAudioError("An unexpected error occurred while accessing media devices.");
        }

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
  }, [cleanupMediaResources, enumerateDevices, startMicMonitor, stopOwnedStream]);

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
    isLoading,
    isMicActive,
    micLevel,
    requestPermissions,
    stopStream,
  };
}
