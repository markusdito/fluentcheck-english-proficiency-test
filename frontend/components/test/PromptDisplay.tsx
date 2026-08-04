"use client";

import { QuestionAudioPlayer } from "@/components/QuestionAudioPlayer";

interface PromptDisplayProps {
  questionNumber: number;
  totalQuestions: number;
  audioUrl: string | null;
  tasks?: string[];
}

export function PromptDisplay({ questionNumber, totalQuestions, audioUrl, tasks }: PromptDisplayProps) {
  return (
    <div className="border border-studio-rule bg-studio-panel p-5">
      <span className="inline-flex items-center border border-studio-rule px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-studio-text/70">
        Question {questionNumber} of {totalQuestions}
      </span>
      <div className="mt-3">
        <QuestionAudioPlayer audioUrl={audioUrl} />
      </div>
      {tasks && tasks.length > 0 && (
        <div className="mt-4 bg-studio p-4">
          <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-studio-text/60">
            Instructions
          </p>
          <ul className="space-y-1.5">
            {tasks.map((task, index) => (
              <li key={index} className="flex items-start gap-2 text-sm leading-6 text-studio-text/80">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-[1px] bg-studio-text/50" />
                {task}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
