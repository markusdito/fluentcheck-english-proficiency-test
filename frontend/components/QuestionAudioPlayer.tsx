"use client";

interface QuestionAudioPlayerProps {
  audioUrl: string | null;
  compact?: boolean;
}

/**
 * Minimal audio player for a question's prompt audio.
 *
 * Iteration 7/8 will add autoplay + replay behaviour on the test page; this
 * shared component keeps the compile bridge functional until then. Renders a
 * placeholder when the question has no audio yet (not uploaded).
 */
export function QuestionAudioPlayer({ audioUrl, compact }: QuestionAudioPlayerProps) {
  if (!audioUrl) {
    return (
      <p className="text-sm text-ink-soft">
        {compact ? "Audio pending" : "Audio not yet available for this question."}
      </p>
    );
  }

  return (
    <audio
      src={audioUrl}
      controls
      preload="metadata"
      className={compact ? "h-9 w-full" : "w-full"}
    >
      <p className="text-sm text-ink-soft">
        Your browser does not support audio playback.
      </p>
    </audio>
  );
}
