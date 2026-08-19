"use client";

import { useState } from "react";
import { PlayIcon } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import { QuestionAudioPlayer } from "@/components/QuestionAudioPlayer";
import { Button } from "@/components/ui/button";

interface LazyAnswerMediaProps {
  audioUrl: string | null;
  videoUrl: string | null;
  durationSeconds?: number;
  questionNumber: number;
  unavailableMessage?: string;
}

export function LazyAnswerMedia({
  audioUrl,
  videoUrl,
  durationSeconds,
  questionNumber,
  unavailableMessage = "Recording not available",
}: LazyAnswerMediaProps) {
  const [activated, setActivated] = useState(false);
  const hasMedia = Boolean(audioUrl || videoUrl);

  if (!activated) {
    return (
      <div className="flex aspect-video items-center justify-center border border-dashed border-rule-strong bg-paper-raised">
        <div className="text-center">
          <PlayIcon className="mx-auto size-8 text-ink-faint" aria-hidden="true" />
          {hasMedia ? (
            <Button
              className="mt-4"
              variant="outline"
              aria-label={`Load recording for question ${questionNumber}`}
              onClick={() => setActivated(true)}
            >
              Load recording
              <span className="sr-only"> for question {questionNumber}</span>
            </Button>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">{unavailableMessage}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {audioUrl && <QuestionAudioPlayer audioUrl={audioUrl} compact />}
      {videoUrl ? (
        <VideoPlayer src={videoUrl} durationSeconds={durationSeconds} />
      ) : (
        <div className="flex aspect-video items-center justify-center border border-dashed border-rule-strong bg-paper-raised">
          <p className="text-sm text-ink-soft">{unavailableMessage}</p>
        </div>
      )}
    </div>
  );
}
