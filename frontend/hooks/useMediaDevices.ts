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
  void Promise.resolve(audioContext.close()).catch(() => undefined);
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
    } catch {
      source?.disconnect();
      analyser?.disconnect();
      closeAudioContext(audioContext);
    }
  }, []);

  /** Stop mic monitoring and release every resource it owns. */
  const stopMicMonitor = useCallback(() => {
    monitorTokenRef.current = null;
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    closeAudioContext(audioContext);
    setIsMicActive(false);
    setMicLevel(0);
  }, []);

  const cleanupMediaResources = useCallback(
    (resetState = true) => {
      stopMicMonitor();
      const currentStream = streamRef.current;
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (resetState) setStream(null);
      }
    },
    [stopMicMonitor],
  );

  /** Request camera + mic permissions */
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    cleanupMediaResources();
    setIsLoading(true);
    setVideoError(null);
    setAudioError(null);

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setStream(mediaStream);
      streamRef.current = mediaStream;
      await enumerateDevices();
      startMicMonitor(mediaStream);
      setIsLoading(false);
      return true;
    } catch (err: unknown) {
      setIsLoading(false);

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
  }, [cleanupMediaResources, enumerateDevices, startMicMonitor]);

  /** Stop all tracks and clean up — uses ref to avoid recreating on stream state change */
  const stopStream = useCallback(() => {
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
    return () => {
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
