"use client";

import { useEffect, useRef, useState } from "react";
import { h2, meta, section, sectionStack, titleGrid } from "./styles";

const navBtn =
  "inline-grid size-11 cursor-pointer place-items-center rounded-full border border-sn-border transition-colors hover:border-sn-fg hover:bg-sn-fg/6 disabled:cursor-default disabled:border-sn-border disabled:bg-transparent disabled:text-[color-mix(in_oklch,var(--color-sn-muted)_50%,var(--color-sn-surface))]";

// ponytail: placeholder profiles from the design mockup; swap for real examiner data when available.
const examiners = [
  { name: "Dr. Anindya Rahmawati, M.A.", label: "Doctor Anindya Rahmawati", uni: "Sanata Dharma University" },
  { name: "Dr. Samuel Wibowo, M.Ed.", label: "Doctor Samuel Wibowo", uni: "Sanata Dharma University" },
  { name: "Prof. Rina Kusumawati, Ph.D.", label: "Professor Rina Kusumawati", uni: "Sanata Dharma University" },
  { name: "Dr. Michael Tanuwijaya, M.Hum.", label: "Doctor Michael Tanuwijaya", uni: "Sanata Dharma University" },
  { name: "Dr. Farah Azzahra, M.TESOL", label: "Doctor Farah Azzahra", uni: "Sanata Dharma University" },
  { name: "Prof. David Hartono, Ph.D.", label: "Professor David Hartono", uni: "Sanata Dharma University" },
];

const pad = (i: number) => String(i).padStart(2, "0");

export function Examiners() {
  const [idx, setIdx] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const lockUntil = useRef(0);

  const left = (rail: HTMLElement, c: HTMLElement) =>
    c.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft;

  const go = (i: number) => {
    const next = Math.max(0, Math.min(examiners.length - 1, i));
    setIdx(next);
    const rail = railRef.current;
    const card = cardRefs.current[next];
    if (!rail || !card) return;
    const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const to = Math.max(0, Math.min(max, left(rail, card) - (rail.clientWidth - card.offsetWidth) / 2));
    if (Math.abs(rail.scrollLeft - to) <= 1) return;
    lockUntil.current = Date.now() + 480;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: to, behavior: smooth ? "smooth" : "auto" });
  };

  /* manual swipe: the card nearest the rail centre becomes active */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let tick = false;
    const onScroll = () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(() => {
        tick = false;
        if (Date.now() < lockUntil.current) return;
        const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
        let best = 0;
        if (rail.scrollLeft >= max - 1) best = examiners.length - 1;
        else if (rail.scrollLeft > 1) {
          const mid = rail.scrollLeft + rail.clientWidth / 2;
          let bestD = Infinity;
          cardRefs.current.forEach((c, j) => {
            if (!c) return;
            const d = Math.abs(left(rail, c) + c.offsetWidth / 2 - mid);
            if (d < bestD) {
              bestD = d;
              best = j;
            }
          });
        }
        setIdx(best);
      });
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => rail.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className={section} id="examiners">
      <div className={sectionStack}>
        <div className={titleGrid}>
          <h2 className={h2}>Who reviews your answers.</h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`${meta} tabular-nums`} aria-live="polite">
            {pad(idx + 1)} / {pad(examiners.length)}
          </span>
          <button className={navBtn} type="button" aria-label="Previous examiner" disabled={idx <= 0} onClick={() => go(idx - 1)}>
            <svg className="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 6l-6 6 6 6" /></svg>
          </button>
          <button className={navBtn} type="button" aria-label="Next examiner" disabled={idx >= examiners.length - 1} onClick={() => go(idx + 1)}>
            <svg className="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 6l6 6-6 6" /></svg>
          </button>
        </div>
        <div ref={railRef} className="-mx-3.5 snap-x snap-mandatory overflow-x-auto overflow-y-hidden px-3.5 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Examiner profiles">
          <div className="flex gap-5">
            {examiners.map((ex, j) => (
              <article
                key={ex.name}
                ref={(el) => {
                  cardRefs.current[j] = el;
                }}
                className={`flex-[0_0_min(300px,84vw)] snap-center rounded-2xl border bg-sn-surface p-4 transition-[transform,border-color] duration-[450ms] ease-spring sm:flex-[0_0_min(420px,82vw)] sm:p-5 ${j === idx ? "scale-105 border-[color-mix(in_oklch,var(--color-sn-fg)_28%,var(--color-sn-border))]" : "scale-90 cursor-pointer border-sn-border hover:border-[color-mix(in_oklch,var(--color-sn-fg)_18%,var(--color-sn-border))]"}`}
                onClick={() => go(j)}
              >
                <div className="flex aspect-[4/5] flex-col items-center justify-center gap-3 rounded-[10px] bg-sn-field-navy text-sn-navy" role="img" aria-label={`Portrait placeholder for ${ex.label}`}>
                  <svg className="size-18" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="32" cy="24" r="10" />
                    <path d="M12 54c2.5-12 10-18 20-18s17.5 6 20 18" />
                  </svg>
                  <span className={meta}>Portrait placeholder</span>
                </div>
                <h3 className="mt-5 max-w-[18ch] text-xl leading-[1.3] font-semibold tracking-[-0.005em] text-balance">{ex.name}</h3>
                <p className="mt-1.5 max-w-[22ch] text-[15px] text-sn-muted">{ex.uni}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
