// Shared Tailwind class strings for the SpeakNusa auth screens.
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-sn-fg";

export const heading =
  "text-balance text-[30px] font-bold leading-[1.1] tracking-[-0.015em] sm:text-[length:clamp(30px,4vw,40px)]";

export const subheading = "mt-2.5 text-pretty text-base text-sn-muted";

export const errorSummary =
  "rounded-xl border border-sn-danger/30 bg-sn-danger/6 px-3.5 py-3 text-sm text-sn-danger";

export const primaryButton = `mt-1.5 inline-flex min-h-13 w-full items-center justify-center gap-2.5 rounded-full border border-sn-fg bg-sn-fg text-base font-medium text-sn-surface transition-[background-color,transform] duration-300 ease-spring hover:-translate-y-0.5 hover:bg-[color-mix(in_oklch,var(--color-sn-fg),white_14%)] active:translate-y-0 active:duration-75 disabled:pointer-events-none ${focusRing}`;

export const textLink = `inline-flex min-h-11 items-center px-0.5 text-sm font-semibold text-sn-fg underline decoration-sn-fg/30 underline-offset-3 transition-[text-decoration-color] duration-200 ease-standard hover:decoration-sn-fg ${focusRing}`;

// Sign-in form fills the resting height of the sign-up form: fields stay packed under the title,
// the submit button sits on the same line as sign-up's. ponytail: fixed px, update if sign-up fields change.
export const signInFormFill = "flex min-h-[500px] flex-col";
