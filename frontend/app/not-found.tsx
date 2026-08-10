import Link from "next/link";
import { ArrowUpRight, FileQuestion } from "lucide-react";

import { Wordmark } from "@/components/layout/Wordmark";
import { Button } from "@/components/ui/button";

const recordDetails = [
  ["Request", "Unknown route"],
  ["Status", "Not filed"],
  ["Next step", "Return to cover"],
] as const;

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-paper">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Wordmark />
          <p className="hidden font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint sm:block">
            Route desk · Error log 404
          </p>
        </div>
      </header>

      <main
        id="not-found-content"
        className="relative isolate flex flex-1 items-center"
        aria-labelledby="not-found-title"
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-[12%] hidden w-px bg-rule sm:block"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border border-dashed border-signal/30 motion-safe:animate-[spin_28s_linear_infinite]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-10 -top-10 size-44 rounded-full border border-signal/15"
          aria-hidden="true"
        />

        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-20">
          <section className="max-w-2xl animate-rise">
            <div className="flex flex-wrap items-center gap-3">
              <span className="stamp stamp--signal">HTTP 404</span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                Route not found
              </span>
            </div>

            <h1
              id="not-found-title"
              className="mt-7 max-w-xl font-display text-5xl font-medium leading-[0.98] tracking-tight text-ink sm:text-6xl lg:text-[4.5rem]"
            >
              This page isn&apos;t in the record.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-ink-soft">
              The address may be out of date, or this page may have moved to a
              different part of the assessment. Let&apos;s get you back to solid
              ground.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                size="lg"
                render={<Link href="/" />}
              >
                Back to home
                <ArrowUpRight aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                render={<Link href="/login" />}
              >
                Go to sign in
              </Button>
            </div>
          </section>

          <aside
            className="relative overflow-hidden border border-rule bg-paper-raised p-6 shadow-[12px_12px_0_var(--rule)] sm:p-8"
            aria-label="Error details"
          >
            <div
              className="absolute inset-y-0 left-0 w-1 bg-signal"
              aria-hidden="true"
            />
            <div className="flex items-start justify-between gap-6">
              <div className="flex size-11 items-center justify-center border border-rule bg-paper text-signal">
                <FileQuestion aria-hidden="true" className="size-5" />
              </div>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                Case file
              </span>
            </div>

            <div className="mt-10 border-b border-rule pb-8">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                Missing folio
              </p>
              <p className="mt-2 font-display text-8xl font-medium leading-none tracking-[-0.08em] text-ink">
                404
              </p>
            </div>

            <dl className="divide-y divide-rule">
              {recordDetails.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-6 py-4"
                >
                  <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    {label}
                  </dt>
                  <dd className="text-right text-sm font-medium text-ink">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-6 border-t border-rule pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              Not a scoring error · no mark deducted
            </p>
          </aside>
        </div>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-5 sm:px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            FluentCheck · English proficiency test
          </p>
          <p className="hidden text-xs text-ink-soft sm:block">
            Your assessment is still waiting for you.
          </p>
        </div>
      </footer>
    </div>
  );
}
