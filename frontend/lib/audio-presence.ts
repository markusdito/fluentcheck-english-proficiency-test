/** RMS above this (full scale = 1) counts as voice, well above a quiet room's noise floor. */
const SPEECH_RMS = 0.02;
const WINDOW_SECONDS = 0.05;
/** At least this much voiced audio, so a click or a cough does not pass. */
const MIN_VOICED_SECONDS = 0.5;

/** PRD FR-3.2: does the clip contain audible speech, not silence or a muted mic? */
export function hasAudioPresence(samples: Float32Array, sampleRate: number): boolean {
  const windowSize = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
  let voicedWindows = 0;
  for (let start = 0; start + windowSize <= samples.length; start += windowSize) {
    let sumSquares = 0;
    for (let i = start; i < start + windowSize; i += 1) sumSquares += samples[i] * samples[i];
    if (Math.sqrt(sumSquares / windowSize) >= SPEECH_RMS) voicedWindows += 1;
  }
  return voicedWindows * WINDOW_SECONDS >= MIN_VOICED_SECONDS;
}

/** Decode a recorded clip and check it for speech. Null when the browser cannot decode it. */
export async function detectAudioPresence(blob: Blob): Promise<boolean | null> {
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
      .some((samples) => hasAudioPresence(samples, buffer.sampleRate));
  } catch {
    return null;
  } finally {
    void context?.close().catch(() => undefined);
  }
}
