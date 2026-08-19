"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { SignupForm } from "@/components/auth/SignupForm";
import { useSession } from "@/hooks/useSession";
import { Wordmark } from "@/components/layout/Wordmark";
import { BandGauge } from "@/components/ui/BandGauge";

export default function SignupPage() {
  const session = useSession();

  useEffect(() => {
    if (session.data) {
      window.location.href = session.data.role === "ADMIN" ? "/admin" : "/dashboard";
    }
  }, [session.data]);

  if (session.isPending || session.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper lg:flex-row">
      {/* Skip link for accessibility */}
      <a
        href="#signup-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to sign up form
      </a>

      {/* Left: brand panel — band-scale motif (desktop) */}
      <aside className="hidden flex-1 flex-col border-r border-rule lg:flex">
        <div className="flex h-16 items-center border-b border-rule px-8">
          <Wordmark />
        </div>

        <div className="flex flex-1 items-center justify-center px-8 py-10">
          <div className="w-full max-w-sm text-left">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
              FluentCheck · Speaking assessment
            </p>
            <h2 className="mt-5 font-display text-4xl font-medium leading-[1.04] tracking-tight text-ink">
              A certified band score, <em className="text-signal">on camera.</em>
            </h2>
            <p className="mt-5 text-[15px] leading-7 text-ink-soft">
              Create your account, then record short video answers to real
              speaking prompts. Two certified examiners score your
              pronunciation, fluency, vocabulary and grammar.
            </p>

            <div className="mt-10 w-full border border-rule bg-paper-raised px-5 py-5 animate-rise">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              The band scale
            </p>
            <p className="mt-2 font-display text-2xl font-medium tracking-tight text-ink">
              Bands run 1.0 to 6.0, in half steps.
            </p>
            <div className="mt-4">
              <BandGauge band={4.5} max={6} size="md" />
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                Four criteria · two independent examiners
              </p>
            </div>
            <dl className="mt-5 divide-y divide-rule">
              {[
                ["Speaking test", "6–9 video prompts with prep time"],
                ["Marking", "Two independent certified examiners"],
                ["Report", "Band score and notes for every skill"],
              ].map(([term, desc]) => (
                <div key={term} className="flex items-start justify-between gap-6 py-2.5">
                  <dt className="text-sm font-medium text-ink">{term}</dt>
                  <dd className="max-w-[12rem] text-right text-sm leading-5 text-ink-soft">
                    {desc}
                  </dd>
                </div>
              ))}
            </dl>
            </div>
          </div>
        </div>

        <p className="border-t border-rule px-8 py-5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
          © {new Date().getFullYear()} FluentCheck · English proficiency test
        </p>
      </aside>

      {/* Right: signup form panel */}
      <main
        id="signup-content"
        className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6"
      >
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <Wordmark />
          </div>

          <div className="border border-rule bg-paper-raised px-6 py-8 sm:px-8">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              Candidate registration
            </p>
            <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
              Create your account
            </h1>
            <p className="mt-1.5 text-sm leading-6 text-ink-soft">
              Start your English proficiency journey.
            </p>

            <div className="mt-8">
              <SignupForm />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
