import { describe, expect, it } from "vitest";
import { hasAudioPresence } from "@/lib/audio-presence";

const RATE = 8000;
const tone = (seconds: number, amplitude: number) =>
  Float32Array.from({ length: RATE * seconds }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE));

describe("hasAudioPresence", () => {
  it("rejects silence and a quiet noise floor", () => {
    expect(hasAudioPresence(new Float32Array(RATE * 5), RATE)).toBe(false);
    expect(hasAudioPresence(tone(5, 0.005), RATE)).toBe(false);
  });

  it("rejects a short click", () => {
    const clip = new Float32Array(RATE * 5);
    clip.set(tone(0.2, 0.5), RATE);
    expect(hasAudioPresence(clip, RATE)).toBe(false);
  });

  it("accepts audible speech-level sound", () => {
    const clip = new Float32Array(RATE * 5);
    clip.set(tone(2, 0.1), RATE);
    expect(hasAudioPresence(clip, RATE)).toBe(true);
  });
});
