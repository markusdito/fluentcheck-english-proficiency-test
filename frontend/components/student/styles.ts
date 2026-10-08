// Shared Tailwind class strings for the SpeakNusa student dashboard.
export const container = "mx-auto w-full max-w-[1120px] px-5 sm:px-8";
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-sn-fg";
export const card =
  "rounded-2xl border border-sn-border bg-sn-surface px-5 py-6 sm:p-7";
export const meta = "m-0 text-[13px] uppercase tracking-[0.04em] text-sn-muted";
export const h2 =
  "text-balance text-[length:clamp(28px,3vw,36px)] font-bold leading-[1.1] tracking-[-0.015em]";
export const h3 = "text-balance text-[22px] font-semibold leading-[1.3] tracking-[-0.005em]";
export const statNum =
  "font-bold leading-[0.95] tracking-[-0.04em] whitespace-nowrap tabular-nums";

const btn = `inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border px-6 py-3 text-[15px] font-medium tracking-[-0.005em] transition-[transform,background-color,border-color,color] duration-300 ease-spring hover:-translate-y-0.5 active:translate-y-0 active:duration-75 disabled:pointer-events-none disabled:border-sn-border disabled:bg-sn-fg/6 disabled:text-sn-muted max-sm:w-full ${focusRing}`;
export const primaryButton = `${btn} border-sn-fg bg-sn-fg text-sn-surface hover:bg-[color-mix(in_oklch,var(--color-sn-fg),black_12%)]`;
export const secondaryButton = `${btn} border-sn-fg/32 bg-transparent text-sn-fg hover:border-sn-fg hover:bg-sn-fg/6`;
