import type { CSSProperties } from "react";
import Link from "next/link";
import { container, lead } from "./styles";

const css = (v: Record<string, string | number>) => v as CSSProperties;

const waveBars: [number, number, number, number][] = [
  [0.25, 0.62, 1.42, -0.12], [0.3, 0.71, 0.95, -0.81], [0.19, 0.75, 0.96, -0.15],
  [0.27, 0.92, 1.0, -0.36], [0.32, 0.98, 1.36, -0.63], [0.39, 0.57, 1.59, -0.46],
  [0.21, 0.6, 1.15, -1.31], [0.22, 0.81, 1.41, -0.6], [0.3, 0.58, 0.95, -0.33],
  [0.33, 0.74, 1.15, -0.94], [0.28, 0.68, 1.54, -1.12], [0.23, 0.81, 1.32, -1.4],
  [0.34, 0.68, 1.68, -0.19], [0.27, 0.89, 1.02, -0.78], [0.19, 0.85, 1.51, -0.92],
  [0.37, 0.69, 1.46, -0.95], [0.31, 0.76, 1.57, -1.51], [0.28, 0.85, 0.95, -1.12],
];

const criteriaBars = [
  { label: "PRON", t: 0.82 },
  { label: "FLU", t: 0.64 },
  { label: "VOC", t: 0.74 },
  { label: "GRAM", t: 0.52 },
];

/* All illustration sizes use --u (1/430 of the art width) so the drawing scales as one piece. */
const u = (n: number) => `calc(var(--u)*${n})`;

const glassCard = [
  "absolute isolate overflow-hidden text-sn-fg",
  "rounded-[calc(var(--u)*22)] border border-white/75",
  "bg-[linear-gradient(140deg,rgb(255_255_255/0.78),rgb(255_255_255/0.34))] backdrop-blur-[14px] backdrop-saturate-150",
  "shadow-[inset_0_1px_0_rgb(255_255_255/0.95),inset_0_-1px_0_rgb(255_255_255/0.35),inset_0_calc(var(--u)*-14)_calc(var(--u)*24)_rgb(255_255_255/0.18),0_calc(var(--u)*18)_calc(var(--u)*40)_rgb(26_53_92/0.2),0_calc(var(--u)*3)_calc(var(--u)*8)_rgb(26_53_92/0.1)]",
  "animate-ga-float transition-transform duration-400 ease-spring motion-reduce:animate-none",
  "group-hover:[transform:translateY(calc(var(--u)*-4))_scale(1.015)]",
  // glossy top highlight
  "before:absolute before:inset-[0_0_52%_0] before:-z-10 before:rounded-[inherit] before:bg-linear-to-b before:from-white/55 before:to-white/0 before:pointer-events-none",
  // light band sweeping across now and then
  "after:absolute after:inset-0 after:z-2 after:rounded-[inherit] after:pointer-events-none after:[transform:translateX(-130%)] after:animate-ga-sweep after:bg-[linear-gradient(105deg,transparent_38%,rgb(255_255_255/0.6)_50%,transparent_62%)] motion-reduce:after:hidden",
].join(" ");

const micro =
  "whitespace-nowrap text-[length:max(9px,calc(var(--u)*10))] font-semibold tracking-[0.14em] text-sn-muted";
const iconSvg =
  "size-[56%] fill-none stroke-current [stroke-width:1.8] [stroke-linecap:round] [stroke-linejoin:round]";

const headphones = (
  <svg viewBox="0 0 24 24" className={iconSvg}>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <rect x="3" y="14" width="4" height="6" rx="2" />
    <rect x="17" y="14" width="4" height="6" rx="2" />
  </svg>
);

const ear =
  "grid size-[calc(var(--u)*26)] min-h-5 min-w-5 place-items-center rounded-full bg-white/70 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.9),0_calc(var(--u)*2)_calc(var(--u)*6)_rgb(26_53_92/0.15)]";

function HeroArt() {
  return (
    <div
      data-island-target
      role="img"
      aria-label="Glass illustration of the app: a student records an answer with a live waveform, two examiners score four criteria, a status chip moves from uploaded to verified to scored, and a sample band 5 badge appears."
      className="group @container relative order-first mx-auto mb-8 aspect-[430/480] w-[min(260px,64vw)] [--u:calc(100cqw/430)] sm:max-[1239px]:mb-14 sm:max-[1239px]:w-[min(300px,70vw)] min-[1240px]:absolute min-[1240px]:top-1/2 min-[1240px]:right-0 min-[1240px]:m-0 min-[1240px]:w-[min(430px,36vw)] min-[1240px]:-translate-y-1/2"
    >
      <div className="absolute inset-0" aria-hidden="true">
        {/* colour orbs give the glass something to blur */}
        <span className="absolute top-[6%] left-[4%] h-[48%] w-[54%] animate-ga-drift rounded-full bg-[color-mix(in_oklch,var(--color-sn-navy)_62%,white)] opacity-60 blur-[calc(var(--u)*26)] motion-reduce:animate-none" />
        <span
          className="absolute right-[4%] bottom-[8%] h-[44%] w-[52%] animate-ga-drift rounded-full bg-[color-mix(in_oklch,var(--color-sn-green)_70%,white)] opacity-55 blur-[calc(var(--u)*26)] motion-reduce:animate-none"
          style={css({ "--drift-dur": "17s", "--drift-delay": "-5s" })}
        />
        <span
          className="absolute bottom-[2%] left-[8%] h-[24%] w-[30%] animate-ga-drift rounded-full bg-sn-amber opacity-50 blur-[calc(var(--u)*26)] motion-reduce:animate-none"
          style={css({ "--drift-dur": "12s", "--drift-delay": "-9s" })}
        />

        {/* recording card */}
        <div
          className={`${glassCard} top-[12%] left-[4%] flex h-[38%] w-[68%] flex-col justify-between`}
          style={{ padding: u(16) }}
        >
          <div className="flex items-center justify-between gap-[calc(var(--u)*8)]">
            <span
              className={`${micro} inline-flex items-center gap-[calc(var(--u)*6)] rounded-full bg-white/60 px-[calc(var(--u)*10)] py-[calc(var(--u)*4)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.8)]`}
            >
              <i className="size-[max(6px,calc(var(--u)*7))] animate-ga-pulse rounded-full bg-sn-clay motion-reduce:animate-none" />
              PART 2 · REC
            </span>
            <span className="text-[length:max(10px,calc(var(--u)*12))] font-bold text-sn-navy">01:12</span>
          </div>
          <div className="flex items-center gap-[calc(var(--u)*14)]">
            <span className="grid size-[calc(var(--u)*46)] min-h-7 min-w-7 flex-none place-items-center rounded-full bg-white/60 text-sn-navy shadow-[inset_0_1px_0_#fff,0_calc(var(--u)*4)_calc(var(--u)*10)_rgb(26_53_92/0.18)]">
              <svg viewBox="0 0 24 24" className={iconSvg}>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </span>
            <span className="flex h-[calc(var(--u)*50)] min-w-0 flex-1 items-center justify-between gap-[calc(var(--u)*3)]">
              {waveBars.map(([lo, hi, s, d], i) => (
                <i
                  key={i}
                  className="h-full max-w-[calc(var(--u)*6)] min-w-0.5 flex-1 [transform:scaleY(var(--hi))] animate-ga-bar rounded-full bg-sn-navy motion-reduce:animate-none"
                  style={css({ "--lo": lo, "--hi": hi, "--s": `${s}s`, "--d": `${d}s` })}
                />
              ))}
            </span>
          </div>
          <div>
            <span className="block h-[calc(var(--u)*4)] min-h-0.5 overflow-hidden rounded-full bg-sn-navy/15">
              <u className="block h-full origin-left animate-ga-prog rounded-[inherit] bg-sn-navy motion-reduce:animate-none" />
            </span>
            <div className={micro} style={{ marginTop: u(6) }}>
              PREP · RECORD · NEXT PART
            </div>
          </div>
        </div>

        {/* sample band badge */}
        <div
          className={`${glassCard} top-[2%] right-[2%] grid aspect-square w-[30%] place-items-center content-center rounded-full! text-center`}
          style={css({ "--float-dur": "6s", "--float-delay": "-2s" })}
        >
          <span className="absolute inset-[7%] animate-ga-spin rounded-full border-[1.5px] border-dashed border-sn-ink-green opacity-70 motion-reduce:animate-none" />
          <div>
            <span className={`${micro} text-sn-ink-green!`}>BAND</span>
            <span className="block animate-ga-pop text-[length:max(30px,calc(var(--u)*54))] leading-none font-bold text-sn-ink-green motion-reduce:animate-none">
              5
            </span>
            <span className={`${micro} text-sn-ink-green!`}>SAMPLE</span>
          </div>
        </div>

        {/* examiner card */}
        <div
          className={`${glassCard} top-[46%] right-[2%] flex h-[38%] w-[70%] flex-col justify-between`}
          style={css({ padding: u(16), "--float-dur": "8s", "--float-delay": "-4s" })}
        >
          <div className="flex items-center justify-between gap-[calc(var(--u)*8)]">
            <span className="text-[length:max(11px,calc(var(--u)*13))] font-bold tracking-[-0.01em] whitespace-nowrap">
              Two examiners
            </span>
            <span className="inline-flex">
              <i className={`${ear} text-sn-ink-green`}>{headphones}</i>
              <i className={`${ear} -ml-[calc(var(--u)*8)] text-sn-navy`}>{headphones}</i>
            </span>
          </div>
          <div className="grid gap-[calc(var(--u)*8)]">
            {criteriaBars.map((c, i) => (
              <div
                key={c.label}
                className="grid grid-cols-[calc(var(--u)*40)_1fr] items-center gap-[calc(var(--u)*8)]"
                style={css({ "--t": c.t, "--i": i })}
              >
                <span className={`${micro} min-w-[30px]`}>{c.label}</span>
                <b className="block h-[calc(var(--u)*7)] min-h-1 overflow-hidden rounded-full bg-sn-green/20">
                  <u className="block h-full origin-left [transform:scaleX(var(--t))] animate-ga-fill rounded-[inherit] bg-sn-ink-green motion-reduce:animate-none" />
                </b>
              </div>
            ))}
          </div>
        </div>

        {/* status chip: uploaded > verified > scored */}
        <div
          className={`${glassCard} bottom-[4%] left-[4%] inline-flex items-center gap-[calc(var(--u)*8)] rounded-full! py-[calc(var(--u)*9)] pr-[calc(var(--u)*16)] pl-[calc(var(--u)*11)]`}
          style={css({ "--float-dur": "6.5s", "--float-delay": "-1s" })}
        >
          <span className="grid size-[calc(var(--u)*24)] min-h-4.5 min-w-4.5 flex-none place-items-center rounded-full bg-sn-ink-green text-white">
            <svg
              viewBox="0 0 24 24"
              className="size-[62%] animate-ga-check fill-none stroke-current [stroke-dasharray:20] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.4] motion-reduce:animate-none"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span className="grid text-[length:max(11px,calc(var(--u)*13))] font-semibold whitespace-nowrap">
            {["Uploaded", "Verified", "Scored"].map((s, k) => (
              <span
                key={s}
                className="col-start-1 row-start-1 animate-ga-st opacity-0 last:opacity-100 motion-reduce:animate-none motion-reduce:not-last:opacity-0!"
                style={css({ "--k": k })}
              >
                {s}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative py-[clamp(80px,12vw,160px)] before:pointer-events-none before:absolute before:-inset-[8%] before:-z-10 before:animate-wash-drift before:sn-wash-hero motion-reduce:before:animate-none">
      <div className={`${container} relative flex flex-col min-[1240px]:block`}>
        <div className="relative z-1 min-[1240px]:max-w-[58%]">
          <h1
            data-island-target
            className="mb-5 max-w-[32ch] text-[length:clamp(44px,6vw,76px)] leading-[1.04] font-bold tracking-[-0.02em] text-balance"
          >
            Three parts.
            <br />
            Two examiners.
            <br />
            One band.
          </h1>
          <p className={`${lead} mb-8`}>
            SpeakNusa is an English speaking assessment taken in the browser. Record video answers to
            three timed prompts, then receive a one to six band from two independent human examiners.
          </p>
          <div className="inline-flex flex-wrap items-center gap-3">
            {/* glass pill: contrast on the wrapper sharpens the blurred inner rims */}
            <span className="inline-block contrast-300">
              <Link
                href="/signup"
                className="group/start relative z-500 flex h-[clamp(48px,13vw,56px)] cursor-pointer items-center justify-center gap-3 rounded-full border border-double border-[rgb(51_51_51/0.08)] bg-black/2 pr-[calc((clamp(48px,13vw,56px)-clamp(30px,8vw,34px))/2)] pl-[calc(clamp(48px,13vw,56px)/2)] brightness-90 shadow-[inset_2px_-2px_1px_-1px_rgb(255_255_255/0.9),inset_-2px_2px_1px_-1px_rgb(255_255_255/0.9),inset_6px_-6px_1px_-6px_rgb(255_255_255/0.55),inset_-6px_6px_1px_-6px_rgb(255_255_255/0.55),inset_0_0_2px_rgb(0_0_0/0.8),0_4px_8px_rgb(0_0_0/0.2)] backdrop-blur-[2px] transition-all duration-250 select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-offset-5! active:scale-[0.94] motion-reduce:transition-none hover:-translate-y-[3px] hover:bg-transparent before:pointer-events-none before:absolute before:top-[35%] before:left-1/2 before:z-1 before:h-[calc(100%-16px)] before:w-[calc(100%-16px)] before:-translate-x-1/2 before:rounded-full before:border before:border-black/90 before:blur-[8px] after:pointer-events-none after:absolute after:z-501 after:size-full after:rounded-full after:bg-[linear-gradient(45deg,rgb(255_255_255/0.8)_0%,transparent_15%,transparent_85%,rgb(255_255_255/0.8)_100%)] after:blur-[7px]"
              >
                <span className="text-[length:clamp(16px,4.4vw,19px)] leading-[1.2] font-medium whitespace-nowrap text-[#3e3e3e] drop-shadow-[0_25px_3px_rgb(102_102_102/0.15)] group-active/start:text-black">
                  Start an assessment
                </span>
                <span className="flex size-[clamp(30px,8vw,34px)] flex-none items-center justify-center rounded-full bg-[#3e3e3e] shadow-[0_0_6px_rgb(0_0_0/0.3)] transition-transform duration-250 group-active/start:scale-[0.94] motion-reduce:transition-none group-hover/start:scale-110">
                  <svg className="w-3.5 fill-[#f5f5f5]" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
                    <path d="M779.180132 473.232045 322.354755 16.406668c-21.413706-21.413706-56.121182-21.413706-77.534887 0-21.413706 21.413706-21.413706 56.122205 0 77.534887l418.057421 418.057421L244.819868 930.057421c-21.413706 21.413706-21.413706 56.122205 0 77.534887 10.706853 10.706853 24.759917 16.059767 38.767955 16.059767s28.061103-5.353938 38.767955-16.059767L779.180132 550.767955C800.593837 529.35425 800.593837 494.64575 779.180132 473.232045z" />
                  </svg>
                </span>
                <span
                  className="pointer-events-none absolute h-[calc(100%-9px)] w-[calc(100%-9px)] rounded-full border border-white/20 blur-[1px]"
                  aria-hidden="true"
                />
              </Link>
            </span>
            <a
              href="#rubric"
              className="group/arrow inline-flex min-h-11 items-center gap-2 rounded-full px-2 py-3 text-[15px] font-medium tracking-[-0.005em] transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:bg-sn-fg/6 hover:text-sn-muted after:transition-transform after:duration-250 after:ease-spring after:content-['→'] hover:after:translate-x-1"
            >
              See the rubric
            </a>
          </div>
        </div>
        <HeroArt />
      </div>
    </section>
  );
}
