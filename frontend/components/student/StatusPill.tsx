import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "green" | "clay" | "amber" | "navy" | "plain";

const discs: Record<Exclude<Tone, "plain">, { bg: string; icon: ReactNode }> = {
  green: { bg: "bg-sn-ink-green", icon: <path d="M5 12.5l4.5 4.5L19 7.5" /> },
  clay: { bg: "bg-sn-clay", icon: <path d="M7 7l10 10M17 7L7 17" /> },
  amber: { bg: "bg-sn-ink-amber", icon: <path d="M12 6v8M12 18.5v.01" /> },
  navy: { bg: "bg-sn-navy", icon: <path d="M12 11v7M12 6.5v.01" /> },
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  IN_PROGRESS: { label: "In progress", tone: "plain" },
  ABANDONED: { label: "Abandoned", tone: "clay" },
  AWAITING_PAYMENT: { label: "Awaiting payment", tone: "amber" },
  PAID: { label: "Paid", tone: "navy" },
  SCORING: { label: "Scoring", tone: "navy" },
  SCORED: { label: "Scored", tone: "green" },
  CERTIFIED: { label: "Certified", tone: "green" },
  FLAG_REVIEW: { label: "Under review", tone: "amber" },
  VOIDED: { label: "Voided", tone: "clay" },
  // admin-only: assignment, payment, media states
  ASSIGNED: { label: "Assigned", tone: "navy" },
  COMPLETED: { label: "Completed", tone: "green" },
  WAIVED: { label: "Waived", tone: "green" },
  PENDING: { label: "Pending", tone: "amber" },
  FAILED: { label: "Failed", tone: "clay" },
  REFUNDED: { label: "Refunded", tone: "plain" },
  UPLOADED: { label: "Uploaded", tone: "green" },
  AWAITING: { label: "Awaiting score", tone: "amber" },
};

/** Glossy glass status pill with a solid icon disc for coloured tones. */
export function Pill({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  const disc = tone === "plain" ? null : discs[tone];
  return (
    <span
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center gap-2 rounded-full border border-white/90 bg-[linear-gradient(180deg,rgb(255_255_255/0.96),rgb(255_255_255/0.7)_55%,rgb(255_255_255/0.82))] py-1 pr-3.5 text-sm font-semibold leading-[1.2] whitespace-nowrap text-sn-fg shadow-[inset_0_1px_0_white,inset_0_-1px_2px_rgb(38_38_38/0.06),0_1px_2px_rgb(38_38_38/0.08),0_4px_14px_rgb(38_38_38/0.09)] backdrop-blur-[10px] backdrop-saturate-140",
        disc ? "pl-[5px]" : "pl-3.5",
      )}
    >
      {disc ? (
        <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]", disc.bg)} aria-hidden="true">
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            {disc.icon}
          </svg>
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "plain" as const };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
