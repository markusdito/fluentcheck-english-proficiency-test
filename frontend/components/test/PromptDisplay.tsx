"use client";

import { QuestionAudioPlayer } from "@/components/QuestionAudioPlayer";
import { meta } from "@/components/student/styles";
import type { CueCard, DeliveredOption } from "@/types/test";

interface PromptDisplayProps {
  questionNumber: number;
  totalQuestions: number;
  audioUrl: string | null;
  tasks?: string[];
  cueCard?: CueCard | null;
  options?: DeliveredOption[] | null;
  autoPlay?: boolean;
  /** Prompt plays allowed per slot, autoplay included (PRD FR-3.4). */
  maxPlays?: number;
  audioLocked?: boolean;
  onAudioEnded?: () => void;
}

/** Part 2 cue card: the talk topic and the three points to include. */
function CueCardPanel({ cueCard }: { cueCard: CueCard }) {
  return (
    <section aria-labelledby="cue-card-topic" className="rounded-2xl border border-sn-fg p-5">
      <p className={`${meta} mb-1`}>Cue card</p>
      <h3 id="cue-card-topic" className="m-0 text-lg font-semibold">{cueCard.topic}</h3>
      <p className="mt-3 mb-1.5 text-[15px] text-sn-muted">You should say:</p>
      <ul className="m-0 list-disc space-y-1 pl-5 text-base">
        {cueCard.points.map((point, index) => (
          <li key={index}>{point}</li>
        ))}
      </ul>
    </section>
  );
}

/** Part 3 options: always text with an icon, never icons alone (PRD FR-3.9). */
function OptionsPanel({ options }: { options: DeliveredOption[] }) {
  return (
    <section aria-labelledby="options-instruction">
      <p id="options-instruction" className="mb-3 text-base font-medium">
        Look at the four options. Choose <strong>ONE</strong> option and explain why you chose it.
      </p>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {options.map((option, index) => (
          <li key={index} className="flex gap-4 rounded-2xl border border-sn-border p-4">
            {option.iconUrl && (
              // Decorative: the title and bullets carry the meaning.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={option.iconUrl} alt="" className="size-12 flex-none object-contain" />
            )}
            <div className="min-w-0">
              <p className="m-0 font-semibold">
                <span className="sr-only">Option {index + 1}: </span>
                {option.title}
              </p>
              <ul className="mt-1.5 mb-0 list-disc space-y-0.5 pl-5 text-[15px] text-sn-muted">
                {option.bullets.map((bullet, bulletIndex) => (
                  <li key={bulletIndex}>{bullet}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PromptDisplay({
  questionNumber,
  totalQuestions,
  audioUrl,
  tasks,
  cueCard,
  options,
  autoPlay,
  maxPlays,
  audioLocked,
  onAudioEnded,
}: PromptDisplayProps) {
  return (
    <div>
      <h2 className="text-balance text-[length:clamp(24px,3.4vw,34px)] font-bold leading-[1.15] tracking-[-0.015em]">
        Question {questionNumber} of {totalQuestions}
      </h2>
      <div className="my-5">
        <p className={`${meta} mb-2`}>Question audio</p>
        <QuestionAudioPlayer
          audioUrl={audioUrl}
          autoPlay={autoPlay}
          maxPlays={maxPlays}
          locked={audioLocked}
          onEnded={onAudioEnded}
        />
      </div>
      {cueCard && <div className="mb-5"><CueCardPanel cueCard={cueCard} /></div>}
      {options && options.length > 0 && <div className="mb-5"><OptionsPanel options={options} /></div>}
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
