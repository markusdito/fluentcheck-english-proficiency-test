import Link from "next/link";
import type { ReactNode } from "react";
import { AuthSwitch } from "./AuthSwitch";
import { RedirectIfSignedIn } from "./RedirectIfSignedIn";

const facts = [
  {
    title: "Record in one sitting",
    body: "Mic check first, then the tests run back to back.",
    tone: "bg-sn-field-navy text-sn-navy shadow-[0_6px_18px_color-mix(in_oklch,var(--color-sn-navy)_18%,transparent)]",
    icon: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </>
    ),
  },
  {
    title: "Two examiners score",
    body: "Each listens on their own; you get the mean.",
    tone: "bg-sn-field-green text-sn-ink-green shadow-[0_6px_18px_color-mix(in_oklch,var(--color-sn-green)_20%,transparent)]",
    icon: (
      <>
        <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
        <rect x="3" y="14" width="4" height="6" rx="1.5" />
        <rect x="17" y="14" width="4" height="6" rx="1.5" />
      </>
    ),
  },
  {
    title: "One band, 1 to 6",
    body: "Pronunciation, fluency, vocabulary and grammar.",
    tone: "bg-sn-field-amber text-sn-ink-amber shadow-[0_6px_18px_color-mix(in_oklch,var(--color-sn-amber)_24%,transparent)]",
    icon: <path d="M5 20V14M10 20V10M15 20V7M20 20V4" />,
  },
];

const backLink =
  "relative inline-flex min-h-11 items-center px-1 text-sm text-sn-muted transition-colors duration-200 ease-standard hover:text-sn-fg focus-visible:text-sn-fg after:absolute after:inset-x-1 after:bottom-2.5 after:h-[1.5px] after:origin-right after:scale-x-0 after:bg-current after:transition-transform after:duration-160 after:ease-standard hover:after:origin-left hover:after:scale-x-100 hover:after:duration-280 hover:after:ease-spring focus-visible:after:origin-left focus-visible:after:scale-x-100";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-sn-bg font-albert text-base leading-[1.55] text-sn-fg antialiased **:focus-visible:outline-offset-3 **:focus-visible:outline-sn-fg">
      <header className="flex items-center justify-between gap-4 px-4 py-3 sm:px-8 sm:py-[18px]">
        <Link href="/" aria-label="SpeakNusa home" className="inline-flex min-h-11 items-center">
          <span className="text-[17px] font-normal lowercase tracking-[-0.01em] min-[381px]:text-[19px]">
            <b className="font-bold">speak</b>nusa
          </span>
        </Link>
        <Link href="/" className={backLink}>
          Back to home
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-[1120px] flex-1 content-start items-start justify-items-center px-4 pt-3 pb-10 sm:content-center sm:items-center sm:px-8 sm:pt-6 sm:pb-26 min-[921px]:grid-cols-[minmax(0,1fr)_minmax(0,440px)] min-[921px]:gap-16">
        <section aria-label="Account" className="w-full max-w-[480px] min-[921px]:max-w-[440px]">
          <AuthSwitch />
          <RedirectIfSignedIn>{children}</RedirectIfSignedIn>
        </section>

        <aside
          aria-label="About the assessment"
          className="sticky top-6 isolate hidden w-full overflow-hidden rounded-3xl border border-sn-border bg-sn-surface bg-[radial-gradient(60%_45%_at_20%_18%,var(--sn-wash-navy),transparent_70%),radial-gradient(55%_45%_at_85%_88%,var(--sn-wash-green),transparent_70%)] px-9 py-10 min-[921px]:block"
        >
          <h2 className="text-balance text-[28px] font-bold leading-[1.15] tracking-[-0.015em]">
            Your answers, heard by people.
          </h2>
          <ul className="mt-7 grid gap-3.5">
            {facts.map((f) => (
              <li
                key={f.title}
                className="grid grid-cols-[44px_1fr] items-start gap-3.5 rounded-2xl border border-sn-fg/6 bg-white/62 p-3.5 backdrop-blur-md"
              >
                <span aria-hidden="true" className={`grid size-11 place-items-center rounded-xl ${f.tone}`}>
                  <svg
                    viewBox="0 0 24 24"
                    className="size-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {f.icon}
                  </svg>
                </span>
                <div>
                  <b className="block text-[15px] font-semibold">{f.title}</b>
                  <span className="text-sm text-sn-muted">{f.body}</span>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  );
}
