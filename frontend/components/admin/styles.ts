// Shared Tailwind class strings for the SpeakNusa admin console.
import { focusRing, primaryButton, secondaryButton } from "@/components/student/styles";

// For the shadcn <Button> (keeps its `loading` prop); tailwind-merge drops its own sizing/colours.
const onButton = "h-auto max-sm:w-auto focus-visible:ring-0 focus-visible:border-current";
export const btnPrimary = `${primaryButton} ${onButton}`;
export const btnSecondary = `${secondaryButton} ${onButton}`;
export const btnDanger = `${secondaryButton} ${onButton} border-sn-clay/40 text-sn-clay hover:border-sn-clay hover:bg-sn-clay/6`;

export const tableWrap = "overflow-x-auto rounded-2xl border border-sn-border bg-sn-surface";
export const th =
  "border-b border-sn-border px-3 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.05em] text-sn-muted first:pl-5 last:pr-5";
export const td = "border-b border-sn-border px-3 py-3.5 align-middle text-[15px] first:pl-5 last:pr-5";
export const tr = "transition-colors hover:bg-sn-bg [&:last-child>td]:border-b-0";
export const lead = "mt-3 max-w-[60ch] text-[15px] text-sn-muted";
export const empty = "rounded-2xl border border-dashed border-sn-border bg-sn-surface px-6 py-12 text-center text-[15px] text-sn-muted";
export const field =
  "min-h-11 w-full rounded-xl border border-sn-border bg-sn-surface px-3 py-2.5 text-[15px] text-sn-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sn-fg";
export const label = "grid gap-1.5 text-sm text-sn-muted";
export const error = "text-sm text-sn-clay";

const chipBase = `min-h-11 cursor-pointer rounded-full border px-4 text-sm transition-colors duration-200 ${focusRing}`;
export const chip = (on: boolean) =>
  `${chipBase} ${
    on
      ? "border-sn-fg bg-sn-fg text-sn-surface"
      : "border-sn-border bg-sn-surface text-sn-muted hover:border-sn-fg/32 hover:text-sn-fg"
  }`;
