"use client";

import { QuestionAudioPlayer } from "@/components/QuestionAudioPlayer";
import { meta } from "@/components/student/styles";

interface PromptDisplayProps {
  questionNumber: number;
  totalQuestions: number;
  audioUrl: string | null;
  tasks?: string[];
  autoPlay?: boolean;
  onAudioEnded?: () => void;
}

export function PromptDisplay({ questionNumber, totalQuestions, audioUrl, tasks, autoPlay, onAudioEnded }: PromptDisplayProps) {
  return (
    <div>
      <h2 className="text-balance text-[length:clamp(24px,3.4vw,34px)] font-bold leading-[1.15] tracking-[-0.015em]">
        Question {questionNumber} of {totalQuestions}
      </h2>
      <div className="my-5">
        <p className={`${meta} mb-2`}>Question audio</p>
        <QuestionAudioPlayer audioUrl={audioUrl} autoPlay={autoPlay} onEnded={onAudioEnded} />
      </div>
      {tasks && tasks.length > 0 && (
        <ol className="m-0 list-none p-0">
          {tasks.map((task, index) => (
            <li
              key={index}
              className="flex items-baseline gap-5 border-t border-sn-border py-3.5 first:border-sn-fg"
            >
              <span className="flex-none text-[13px] tabular-nums text-sn-muted">Q{index + 1}</span>
              <p className="m-0 text-base">{task}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
