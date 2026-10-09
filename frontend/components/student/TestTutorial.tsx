"use client";

import { useState } from "react";
import { Headphones, ListChecks, Mic, Send, Timer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ghostButton, h3, meta, primaryButton, secondaryButton } from "./styles";

const TUTORIAL_SEEN_KEY = "speaknusa.tutorialSeen";

export function readTutorialSeen(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeTutorialSeen() {
  try {
    window.localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
  } catch {
    // storage blocked: shown again next visit, harmless
  }
}

const STEPS = [
  {
    icon: ListChecks,
    kicker: "Step 1 of 5",
    title: "The test in one sitting",
    body: "Four parts, five spoken answers, about 15 minutes. Once you start, the test runs by itself from the first question to the last. You cannot pause it, so find a quiet room first.",
    tip: "Part 1 asks two short personal questions. Part 2 is a monologue, Part 3 a decision, Part 4 an opinion.",
  },
  {
    icon: Headphones,
    kicker: "Step 2 of 5",
    title: "Listen to the question",
    body: "Each question is read aloud automatically and shown on screen. If you missed something, you can replay the audio once.",
    tip: "Use a headset if you have one: it keeps the question audio out of your recording.",
  },
  {
    icon: Timer,
    kicker: "Step 3 of 5",
    title: "Prepare while the timer runs",
    body: "When the audio ends, a preparation countdown starts. Think about what you will say. For Part 2 you may jot brief notes on paper.",
    tip: "The countdown cannot be stopped. Recording begins the moment it reaches zero.",
  },
  {
    icon: Mic,
    kicker: "Step 4 of 5",
    title: "Speak when recording starts",
    body: "Your camera and microphone record automatically. Keep talking until the timer ends, or press \u201cStop and submit answer\u201d if you finish early.",
    tip: "One take per answer. There is no preview and no re-record, so just keep speaking naturally.",
  },
  {
    icon: Send,
    kicker: "Step 5 of 5",
    title: "Answers save in the background",
    body: "After each answer the test moves to the next part on its own. Uploads happen while you continue. At the end, keep the page open until every answer shows as saved.",
    tip: "Two examiners score your submission independently. Your result appears on this dashboard when both are done.",
  },
];

interface TestTutorialProps {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
}

/** First-visit walkthrough of the speaking-test flow. Reopenable from the start card. */
export function TestTutorial({ open, onClose, onStart }: TestTutorialProps) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const Icon = step.icon;

  const finish = (next?: () => void) => {
    writeTutorialSeen();
    setIndex(0);
    onClose();
    next?.();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) finish(); }}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[520px]! gap-0 rounded-2xl bg-sn-surface px-5 py-6 font-albert text-base text-sn-fg ring-sn-border sm:p-7"
      >
        <div className="flex items-center justify-between gap-3">
          <p className={meta}>{step.kicker}</p>
          <button type="button" className={cn(ghostButton, "min-h-9 text-sm")} onClick={() => finish()}>
            Skip
          </button>
        </div>

        <div className="mt-4 flex size-12 items-center justify-center rounded-full bg-sn-fg text-sn-surface">
          <Icon className="size-6" aria-hidden="true" />
        </div>

        <DialogTitle className={cn(h3, "mt-4 leading-[1.3] text-sn-fg")}>{step.title}</DialogTitle>
        <DialogDescription className="mt-2 text-[15px] leading-[1.55] text-sn-muted">{step.body}</DialogDescription>
        <p className="mt-4 rounded-[10px] bg-sn-field-amber p-4 text-[15px]">{step.tip}</p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-sn-border pt-5">
          <div className="flex items-center gap-2" role="img" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={cn("h-1.5 w-6 rounded-full transition-colors", i <= index ? "bg-sn-fg" : "bg-sn-border")}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && (
              <button type="button" className={cn(secondaryButton, "max-sm:w-auto")} onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            {last ? (
              <button type="button" className={cn(primaryButton, "max-sm:w-auto")} onClick={() => finish(onStart)}>
                Start speaking test
              </button>
            ) : (
              <button type="button" className={cn(primaryButton, "max-sm:w-auto")} onClick={() => setIndex(index + 1)}>
                Next
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
