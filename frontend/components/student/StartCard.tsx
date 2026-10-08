import { ChevronDown } from "lucide-react";
import { Pill } from "./StatusPill";
import { card, h3, meta, primaryButton } from "./styles";

const parts = [
  { title: "Part 1 · Personal response", body: "Tasks 1A and 1B: two short answers about familiar topics, 45 seconds each." },
  { title: "Part 2 · Monologue", body: "One cue card. Plan for a minute, then talk for 90 seconds." },
  { title: "Part 3 · Decision-making", body: "Choose one of four options and explain why, in 90 seconds." },
  { title: "Part 4 · Opinion", body: "Give and support your opinion on one question in 60 seconds." },
];

const stats = [
  { fig: "5", cap: "answers, one take each" },
  { fig: "2", cap: "examiners score it" },
  { fig: "1", cap: "sitting, start to end" },
];

export function StartCard({ onStart }: { onStart: () => void }) {
  return (
    <article className={card}>
      <p className={meta}>Speaking test · one sitting</p>
      <h3 className={`${h3} mt-2`}>Take the speaking test</h3>
      <p className="mt-2 max-w-[60ch] text-pretty text-sn-muted">
        Four parts, five answers, one after another. Each question is played aloud
        and you may replay it once. Preparation starts when the audio ends, recording
        starts and stops on its own, and the test moves on by itself. Each answer is
        recorded once: there is no preview and no re-record.
      </p>

      <div className="mt-5 grid grid-cols-3 gap-3 border-y border-sn-border py-5">
        {stats.map((s) => (
          <div key={s.cap} className="grid min-w-0 gap-1.5">
            <span className="text-[length:clamp(28px,4vw,40px)] leading-none font-bold tracking-[-0.03em] tabular-nums">
              {s.fig}
            </span>
            <span className="text-[13px] text-sn-muted">{s.cap}</span>
          </div>
        ))}
      </div>

      <details className="group mt-5 border-b border-sn-border">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
          <span className="underline-offset-4 hover:underline">What to expect</span>
          <ChevronDown className="size-4 shrink-0 transition-transform duration-200 ease-out group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="pb-1">
          {parts.map((p) => (
            <div key={p.title} className="border-t border-sn-border py-5">
              <h4 className="mb-1 text-[17px] font-semibold">{p.title}</h4>
              <p className="m-0 text-sm text-sn-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </details>

      <div className="mt-5 flex items-start gap-3 rounded-[10px] bg-sn-field-amber p-4">
        <span className="-mt-1">
          <Pill tone="amber">Keep going</Pill>
        </span>
        <p className="m-0 text-[15px]">
          Timers keep running once a part starts and cannot be paused. Pick a quiet
          room, use a headset if you can, and keep about 15 minutes free before you begin.
        </p>
      </div>

      <div className="mt-5 flex justify-end">
        <button className={primaryButton} type="button" onClick={onStart}>
          Start speaking test
        </button>
      </div>
    </article>
  );
}
