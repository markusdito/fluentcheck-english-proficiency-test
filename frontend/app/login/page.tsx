"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { LoginForm } from "@/components/auth/LoginForm";
import { api } from "@/lib/api";
import { Wordmark } from "@/components/layout/Wordmark";
import { BandGauge } from "@/components/ui/BandGauge";
import { Stamp } from "@/components/ui/Stamp";

const specimen = [
  { label: "Pronunciation", band: 4.5 },
  { label: "Fluency", band: 5.0 },
  { label: "Vocabulary", band: 4.5 },
  { label: "Grammar", band: 4.0 },
];

export default function LoginPage() {
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.get("/auth/me");
        if (!cancelled) {
          window.location.href = "/dashboard";
        }
      } catch {
        if (cancelled) return;
        setCheckingAuth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (checkingAuth) {
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
        href="#login-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to login form
      </a>

      {/* Left: brand panel — specimen report motif (desktop) */}
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
              Your band, and the examiners&apos; notes, in{" "}
              <em className="text-signal">one place.</em>
            </h2>
            <p className="mt-5 text-[15px] leading-7 text-ink-soft">
              Sign in to record your answers, settle your assessment fee, and pick
              up your certificate once the jury has marked you.
            </p>

            <div className="mt-10 w-full border border-rule bg-paper-raised animate-rise">
            <div className="flex items-center justify-between border-b border-rule px-5 py-3">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                Specimen report
              </p>
              <Stamp tone="verified" dot>
                Certified
              </Stamp>
            </div>
            <div className="px-5 py-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                    Overall band
                  </p>
                  <p className="mt-1 font-display text-5xl font-medium leading-none tracking-tight text-ink">
                    4.50
                  </p>
                </div>
                <p className="pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                  Out of 6
                </p>
              </div>
              <div className="mt-4">
                <BandGauge band={4.5} max={6} size="md" />
              </div>
              <dl className="mt-5 divide-y divide-rule">
                {specimen.map((c) => (
                  <div
                    key={c.label}
                    className="flex items-center justify-between gap-4 py-2.5"
                  >
                    <dt className="text-sm font-medium text-ink">{c.label}</dt>
                    <dd className="flex items-center gap-4">
                      <span className="hidden w-32 sm:block">
                        <BandGauge band={c.band} size="sm" showValue={false} />
                      </span>
                      <span className="w-8 text-right font-mono text-sm tabular-nums text-ink">
                        {c.band.toFixed(1)}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            </div>
          </div>
        </div>

        <p className="border-t border-rule px-8 py-5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
          © {new Date().getFullYear()} FluentCheck · English proficiency test
        </p>
      </aside>

      {/* Right: login form panel */}
      <main
        id="login-content"
        className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6"
      >
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <Wordmark />
          </div>

          <div className="border border-rule bg-paper-raised px-6 py-8 sm:px-8">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              Candidate login
            </p>
            <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm leading-6 text-ink-soft">
              Sign in to your account to continue.
            </p>

            <div className="mt-8">
              <LoginForm />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
