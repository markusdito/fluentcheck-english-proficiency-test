"use client";

import { ArrowRight, Dumbbell } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { focusRing, h3 } from "./styles";

const option = cn(
  "flex w-full cursor-pointer items-start gap-4 rounded-[14px] border border-sn-border bg-transparent p-4 text-left text-sn-fg transition-colors duration-200 hover:border-sn-fg hover:bg-sn-fg/4",
  focusRing,
);

interface PracticeChoiceDialogProps {
  open: boolean;
  onClose: () => void;
  /** true = practice run, false = real test. The hardware check follows either way. */
  onChoose: (practice: boolean) => void;
}

/** Shown after "Start speaking test": practise first, or go straight to the real test. */
export function PracticeChoiceDialog({ open, onClose, onChoose }: PracticeChoiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-[520px]! gap-0 rounded-2xl bg-sn-surface px-5 py-6 font-albert text-base text-sn-fg ring-sn-border sm:p-7">
        <DialogTitle className={cn(h3, "pr-8 leading-[1.3] text-sn-fg")}>Practise first?</DialogTitle>
        <DialogDescription className="mt-2 text-[15px] leading-[1.55] text-sn-muted">
          A practice run works exactly like the real test, with sample questions. You check your
          camera and microphone next, either way.
        </DialogDescription>

        <div className="mt-5 grid gap-3">
          <button type="button" className={option} onClick={() => onChoose(true)}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sn-fg text-sn-surface">
              <Dumbbell className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[17px] font-semibold">Practice test</span>
              <span className="mt-0.5 block text-sm text-sn-muted">Not scored, nothing is saved. Try it as often as you like.</span>
            </span>
          </button>
          <button type="button" className={option} onClick={() => onChoose(false)}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-sn-fg text-sn-fg">
              <ArrowRight className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[17px] font-semibold">Real test</span>
              <span className="mt-0.5 block text-sm text-sn-muted">Scored by two examiners. One sitting, about 15 minutes.</span>
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
