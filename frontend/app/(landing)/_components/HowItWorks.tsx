"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { h2, lead, meta, section, sectionStack } from "./styles";

const lines = "grid gap-1.5";
const line = "flex items-center justify-between gap-2 whitespace-nowrap";

const Check = () => (
  <svg className="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 6.5l2.5 2.5L10 3.5" />
  </svg>
);

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

interface Step {
  tone: string;
  title: string;
  desc: string;
  icon: ReactNode;
  panel: ReactNode;
  chip: string;
}

const steps: Step[] = [
  {
    tone: "bg-sn-navy text-sn-bg",
    title: "Camera & mic check",
    desc: "Grant camera and microphone access, see your live preview and input level, and confirm everything works before any prompt opens.",
    icon: (
      <svg {...iconProps}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    ),
    panel: (
      <>
        <p>Input level</p>
        <div className="flex min-h-8 flex-[1_1_0] items-stretch gap-1" aria-hidden="true">
          {[3, 6, 4, 9, 7, 5, 8, 4, 2].map((v, i) => (
            <i key={i} className="flex-[1_1_0] origin-bottom rounded-[3px] bg-current" style={{ transform: `scaleY(${v / 10})` }} />
          ))}
        </div>
      </>
    ),
    chip: "Browser only",
  },
  {
    tone: "bg-sn-clay text-sn-bg",
    title: "Record four parts",
    desc: "Two short personal responses, a monologue, a decision-making task, and an opinion. Each answer gets its own preparation time, then recording starts and stops automatically. One take per answer, no re-record.",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    panel: (
      <>
        <div className={lines}>
          <div className={line}><span>Part 1</span><span>Personal response</span></div>
          <div className={line}><span>Part 2</span><span>Monologue</span></div>
          <div className={line}><span>Part 3</span><span>Decision-making</span></div>
          <div className={line}><span>Part 4</span><span>Opinion</span></div>
        </div>
        <p className="tabular-nums">Prep time · timed video</p>
      </>
    ),
    chip: "Final take kept",
  },
  {
    tone: "bg-sn-amber text-sn-fg",
    title: "Upload and verify",
    desc: "Video goes straight to storage. The server checks size, duration, and type before an answer counts.",
    icon: (
      <svg {...iconProps}>
        <path d="M12 16V5M7 10l5-5 5 5M5 19h14" />
      </svg>
    ),
    panel: (
      <>
        <div className={lines}>
          {["Part 1", "Part 2", "Part 3", "Part 4"].map((p) => (
            <div key={p} className={line}>
              <span>{p}</span>
              <span className="inline-flex items-center gap-1 font-semibold"><Check />Verified</span>
            </div>
          ))}
        </div>
        <p>Size · duration · type</p>
      </>
    ),
    chip: "Server checked",
  },
  {
    tone: "bg-sn-ink-green text-sn-bg",
    title: "Two examiners score",
    desc: "Once payment is settled or waived, two examiners work independently on four criteria in half band steps.",
    icon: (
      <svg {...iconProps}>
        <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
        <rect x="3" y="14" width="4" height="6" rx="1.5" />
        <rect x="17" y="14" width="4" height="6" rx="1.5" />
      </svg>
    ),
    panel: (
      <>
        <div className={lines}>
          {["Examiner 1", "Examiner 2"].map((e) => (
            <div key={e} className={line}>
              <span>{e}</span>
              <span className="flex gap-1" aria-hidden="true">{[0, 1, 2, 3].map((p) => <i key={p} className="block size-2 rounded-full bg-current" />)}</span>
            </div>
          ))}
        </div>
        <p>Four criteria each</p>
      </>
    ),
    chip: "Independent",
  },
  {
    tone: "bg-sn-field-navy text-sn-navy",
    title: "Read your report",
    desc: "One overall band and four criterion bands, each the mean of two independent examiners, plus written comments from both.",
    icon: (
      <svg {...iconProps}>
        <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />
      </svg>
    ),
    panel: (
      <>
        <div>
          <p className="text-[length:clamp(32px,9cqw,44px)] leading-none font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums">4.5</p>
          <p>Sample band</p>
        </div>
        <div className="h-1.5 rounded-[3px] bg-current/16" aria-hidden="true"><i className="block h-full w-[70%] rounded-[inherit] bg-current" /></div>
      </>
    ),
    chip: "Band 1 to 6",
  },
];

/* cursor parallax rides on `translate` so the selection spring on `transform` never restarts;
   z-index transitions on the same curve so cards trade depth mid-move */
const card = [
  "absolute top-6 left-[calc(50%-var(--hw-w)/2)] flex aspect-[2/3] w-(--hw-w) flex-col gap-3 rounded-[28px] p-[clamp(16px,5cqw,24px)]",
  "border border-white/40 shadow-[0_24px_48px_-24px_color-mix(in_oklch,var(--color-sn-navy)_45%,transparent)] will-change-transform",
  "[translate:calc(var(--px,0)*var(--a,0)*10px)_calc(var(--py,0)*var(--a,0)*6px)]",
  "[transform:translateX(calc(var(--o,0)*var(--hw-shift)))_rotate(calc(var(--o,0)*1.5deg))_scale(calc(1-var(--a,0)*0.1))]",
  "transition-[transform,z-index] duration-[520ms] ease-standard delay-[calc(var(--a,0)*30ms)]",
  // glare that tracks the pointer on the front card
  "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:opacity-0 before:transition-opacity before:duration-300",
  "before:bg-[radial-gradient(200px_circle_at_var(--gx,50%)_var(--gy,30%),color-mix(in_oklch,white_28%,transparent),transparent_70%)]",
  "group-data-hot/stage:data-active:before:opacity-100",
].join(" ");

const n = steps.length;
const pad = (i: number) => String(i).padStart(2, "0");
/* circular offset keeps two cards fanned on each side of the active one */
const offset = (j: number, i: number) => {
  let o = (((j - i) % n) + n) % n;
  if (o > n / 2) o -= n;
  return o;
};

export function HowItWorks() {
  const [idx, setIdx] = useState(0);
  const prevIdx = useRef(0);
  const deckRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hoverTimer = useRef<number | undefined>(undefined);

  /* a card that wraps from one end of the fan to the other fades while crossing behind */
  useEffect(() => {
    const from = prevIdx.current;
    prevIdx.current = idx;
    if (from === idx) return;
    cardRefs.current.forEach((card, j) => {
      if (!card) return;
      if (Math.abs(offset(j, idx) - offset(j, from)) > n / 2) {
        card.classList.remove("animate-hw-wrap");
        void card.offsetWidth;
        card.classList.add("animate-hw-wrap");
      }
    });
  }, [idx]);

  /* cursor tilt, depth parallax, and a glare that tracks the pointer on the front card */
  useEffect(() => {
    const deck = deckRef.current;
    const stage = stageRef.current;
    if (!deck || !stage) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const frame = () => {
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      stage.style.setProperty("--px", cx.toFixed(3));
      stage.style.setProperty("--py", cy.toFixed(3));
      raf = Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(frame) : 0;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const r = deck.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
      ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
      const active = stage.querySelector("[data-active]");
      if (active) {
        const a = active.getBoundingClientRect();
        stage.style.setProperty("--gx", `${e.clientX - a.left}px`);
        stage.style.setProperty("--gy", `${e.clientY - a.top}px`);
      }
      stage.setAttribute("data-hot", "");
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      stage.removeAttribute("data-hot");
      if (!raf) raf = requestAnimationFrame(frame);
    };
    deck.addEventListener("pointermove", onMove);
    deck.addEventListener("pointerleave", onLeave);
    return () => {
      deck.removeEventListener("pointermove", onMove);
      deck.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  return (
    <section className={section} id="journey">
      <div className={sectionStack}>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex flex-col gap-5">
            <h2 className={h2}>How it works.</h2>
            <p className={lead}>
              Five steps carry every submission from the first device check to the final band.
            </p>
          </div>
          <span className={`${meta} tabular-nums`} aria-live="polite">
            {pad(idx + 1)} / {pad(n)}
          </span>
        </div>
        <div className="grid grid-cols-1 items-center gap-8 min-[921px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] min-[921px]:gap-14">
          <div ref={deckRef} className="@container mx-auto w-full max-w-[560px]" role="group" aria-label="Step preview cards">
            <div ref={stageRef} className="group/stage relative h-[calc(var(--hw-w)*1.5+48px)] [--hw-shift:min(68px,12cqw)] [--hw-w:min(300px,58cqw)] [transform:perspective(1100px)_rotateX(calc(var(--py,0)*-4deg))_rotateY(calc(var(--px,0)*6deg))]">
              {steps.map((s, j) => {
                const o = offset(j, idx);
                return (
                  <div
                    key={s.title}
                    ref={(el) => {
                      cardRefs.current[j] = el;
                    }}
                    className={`${card} ${s.tone} ${o === 0 ? "cursor-default" : "cursor-pointer"}`}
                    data-active={o === 0 || undefined}
                    style={{ "--o": o, "--a": Math.abs(o), zIndex: 10 - Math.abs(o) } as CSSProperties}
                    aria-hidden={o !== 0 || undefined}
                    onClick={() => setIdx(j)}
                    onAnimationEnd={(e) => e.currentTarget.classList.remove("animate-hw-wrap")}
                  >
                    <div className="relative z-1 flex items-center justify-between">
                      <span className="grid size-9 place-items-center rounded-[10px] border border-current/20 bg-current/12 [&_svg]:size-4.5">{s.icon}</span>
                      <span className="text-[13px] tracking-[0.04em] tabular-nums">{pad(j + 1)}</span>
                    </div>
                    <h3 className="relative z-1 text-[length:clamp(18px,4.6cqw,24px)] leading-[1.2] font-semibold">{s.title}</h3>
                    <div className="relative z-1 flex min-h-0 flex-[1_1_0] flex-col justify-between gap-2 rounded-[14px] border border-current/16 bg-current/8 p-3 text-[13px] leading-[1.4]">{s.panel}</div>
                    <p className="relative z-1 self-start rounded-full border border-current/28 px-2.5 py-1 text-[11px] tracking-[0.04em] whitespace-nowrap uppercase">{s.chip}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <ol className="grid gap-2">
            {steps.map((s, j) => (
              <li key={s.title}>
                <button
                  className="group/step grid w-full cursor-pointer grid-cols-[36px_minmax(0,1fr)] items-start gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-sn-fg/6 aria-[current=step]:bg-sn-fg/6 sm:gap-4 sm:p-4"
                  type="button"
                  aria-current={j === idx ? "step" : undefined}
                  onClick={() => {
                    window.clearTimeout(hoverTimer.current);
                    setIdx(j);
                  }}
                  onFocus={() => setIdx(j)}
                  onPointerEnter={(e) => {
                    if (e.pointerType !== "mouse") return;
                    window.clearTimeout(hoverTimer.current);
                    /* hover intent: sweeping down the list does not shuffle the deck on every row */
                    hoverTimer.current = window.setTimeout(() => setIdx(j), 90);
                  }}
                  onPointerLeave={() => window.clearTimeout(hoverTimer.current)}
                >
                  <span className="grid size-9 place-items-center rounded-full border border-sn-border text-[13px] tabular-nums transition-colors group-aria-[current=step]/step:border-sn-fg group-aria-[current=step]/step:bg-sn-fg group-aria-[current=step]/step:text-sn-surface">{pad(j + 1)}</span>
                  <span className="grid gap-1">
                    <span className="block text-lg leading-[1.3] font-semibold tracking-[-0.005em]">{s.title}</span>
                    <span className="block text-[15px] text-sn-muted min-[921px]:max-w-[52ch]">{s.desc}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
