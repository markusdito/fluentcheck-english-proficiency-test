import type { ReactNode } from "react";
import { h2, meta, section, sectionStack } from "./styles";

const roles: { seat: string; title: string; body: string; label: string; tone: string; art: ReactNode }[] = [
  {
    seat: "Student",
    title: "Record with a webcam and microphone",
    body: "Finish four parts in about fifteen minutes. Read one clear band with criterion feedback.",
    label: "Student: microphone with a live input level meter",
    tone: "text-sn-navy [--art-field:var(--color-sn-field-navy)] [--art-glow:color-mix(in_oklch,var(--color-sn-navy)_70%,white)]",
    art: (
      <svg className="relative size-full" viewBox="0 0 220 120" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="40" y="26" width="22" height="40" rx="11" />
        <path d="M32 56v2a19 19 0 0 0 38 0v-2M51 77v14M41 91h20" />
        <g fill="currentColor" stroke="none">
          <rect x="96" y="77" width="8" height="14" rx="3" />
          <rect x="110" y="61" width="8" height="30" rx="3" />
          <rect x="124" y="69" width="8" height="22" rx="3" />
          <rect x="138" y="45" width="8" height="46" rx="3" />
          <rect x="152" y="57" width="8" height="34" rx="3" />
          <rect x="166" y="39" width="8" height="52" rx="3" />
          <rect x="180" y="65" width="8" height="26" rx="3" />
        </g>
      </svg>
    ),
  },
  {
    seat: "Examiner",
    title: "Work an assigned queue",
    body: "Play verified recordings, enter four criteria per answer, and complete a scoring that can no longer be edited.",
    label: "Examiner: headphones beside four criterion score bars",
    tone: "text-sn-ink-green [--art-field:var(--color-sn-field-green)] [--art-glow:var(--color-sn-green)]",
    art: (
      <svg className="relative size-full" viewBox="0 0 220 120" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M30 62a24 24 0 0 1 48 0" />
        <rect x="26" y="60" width="10" height="24" rx="5" />
        <rect x="72" y="60" width="10" height="24" rx="5" />
        <g stroke="none">
          <g fill="currentColor" opacity="0.22">
            <rect x="108" y="29" width="84" height="8" rx="4" />
            <rect x="108" y="49" width="84" height="8" rx="4" />
            <rect x="108" y="69" width="84" height="8" rx="4" />
            <rect x="108" y="89" width="84" height="8" rx="4" />
          </g>
          <g fill="currentColor">
            <rect x="108" y="29" width="60" height="8" rx="4" />
            <rect x="108" y="49" width="48" height="8" rx="4" />
            <rect x="108" y="69" width="72" height="8" rx="4" />
            <rect x="108" y="89" width="40" height="8" rx="4" />
          </g>
        </g>
      </svg>
    ),
  },
  {
    seat: "Admin",
    title: "Run the pipeline",
    body: "Question bank and prompt audio, payment control and waivers, examiner assignment sets of two.",
    label: "Admin: one submission routed to a set of two examiners, then completed",
    tone: "text-sn-ink-amber [--art-field:var(--color-sn-field-amber)] [--art-glow:var(--color-sn-amber)]",
    art: (
      <svg className="relative size-full" viewBox="0 0 220 120" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M56 60C80 60 90 36 102 36M56 60C80 60 90 84 102 84M122 36C140 36 150 60 164 60M122 84C140 84 150 60 164 60" />
        <circle cx="44" cy="60" r="12" />
        <circle cx="112" cy="36" r="10" />
        <circle cx="112" cy="84" r="10" />
        <circle cx="176" cy="60" r="12" fill="currentColor" />
        <path d="M169.5 60.5l4.5 4.5 8-9" stroke="var(--color-sn-field-amber)" />
      </svg>
    ),
  },
];

export function Roles() {
  return (
    <section className={section} id="roles">
      <div className={sectionStack}>
        <h2 className={h2}>Three seats around one submission.</h2>
        <div className="grid grid-cols-1 items-start gap-8 min-[761px]:grid-cols-3 min-[761px]:max-[920px]:gap-5">
          {roles.map((r) => (
            <article key={r.seat} className="group grid content-start gap-3">
              {/* ::before is a blurred halo bleeding past the tile; ::after is the tile with a soft bloom behind the drawing */}
              <figure
                role="img"
                aria-label={r.label}
                className={`relative isolate order-first m-0 aspect-[11/6] w-full rounded-2xl max-[760px]:max-w-[320px] before:pointer-events-none before:absolute before:-inset-1 before:-z-20 before:translate-y-2 before:rounded-[inherit] before:bg-(--art-glow) before:opacity-40 before:blur-[24px] before:transition-[opacity,transform] before:duration-400 before:ease-spring group-hover:before:translate-y-2.5 group-hover:before:scale-[1.04] group-hover:before:opacity-60 after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:rounded-[inherit] after:bg-[radial-gradient(70%_95%_at_50%_55%,color-mix(in_oklch,var(--art-glow)_22%,transparent),transparent_72%),var(--art-field)] ${r.tone}`}
              >
                {r.art}
              </figure>
              <p className={`${meta} mt-2`}>{r.seat}</p>
              <div>
                <h3 className="mb-1.5 text-[17px] leading-[1.3] font-semibold tracking-[-0.005em]">{r.title}</h3>
                <p className="text-[15px] text-sn-muted">{r.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
