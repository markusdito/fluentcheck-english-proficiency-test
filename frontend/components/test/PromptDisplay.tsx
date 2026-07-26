"use client";

interface PromptDisplayProps {
  questionNumber: number;
  totalQuestions: number;
  text: string;
  tasks?: string[];
}

export function PromptDisplay({ questionNumber, totalQuestions, text, tasks }: PromptDisplayProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
          Question {questionNumber} of {totalQuestions}
        </span>
      </div>
      <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">
        {text}
      </h2>
      {tasks && tasks.length > 0 && (
        <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
          <p className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Instructions:
          </p>
          <ul className="space-y-1.5">
            {tasks.map((task, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                {task}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
