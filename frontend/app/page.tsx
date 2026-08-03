import { Wordmark } from "@/components/layout/Wordmark";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { BandGauge } from "@/components/ui/BandGauge";

const protocol = [
  {
    step: "1",
    title: "Record your answers",
    body: "We check your camera and microphone, then take you through the speaking prompts. You get prep time before each answer.",
  },
  {
    step: "2",
    title: "Pay the assessment fee",
    body: "You only pay once your answers are in — IDR 150,000, settled with iPaymu.",
  },
  {
    step: "3",
    title: "Two examiners mark you",
    body: "Your recording is scored independently by two certified examiners on pronunciation, fluency, vocabulary and grammar.",
  },
  {
    step: "4",
    title: "Get your certificate",
    body: "Your band report and the examiners' notes land in your dashboard. Share it anywhere an English score counts.",
  },
];

const criteria = [
  { label: "Pronunciation", band: 7.0 },
  { label: "Fluency", band: 7.5 },
  { label: "Vocabulary", band: 7.5 },
  { label: "Grammar", band: 7.0 },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* Masthead */}
      <header className="border-b border-rule">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Wordmark />
          <nav
            className="flex items-center gap-2 sm:gap-3"
            aria-label="Account"
          >
            <Button variant="ghost" size="sm" href="/login">
              Sign in
            </Button>
            <Button variant="primary" size="sm" href="/signup">
              Start your assessment
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — booklet cover */}
        <section className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 sm:pt-20">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div className="max-w-xl animate-rise">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
                FluentCheck · Speaking assessment
              </p>
              <h1 className="mt-6 font-display text-5xl font-medium leading-[0.98] tracking-tight text-ink sm:text-6xl lg:text-[4.25rem]">
                Prove your English,{" "}
                <em className="text-signal">on camera.</em>
              </h1>
              <p className="mt-6 text-lg leading-8 text-ink-soft">
                Record short video answers to real speaking prompts. Two
                examiners score your pronunciation, fluency, vocabulary and
                grammar. You get a band out of nine — the scale universities
                and employers already trust.
              </p>

              <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button variant="primary" size="lg" href="/signup">
                  Start your assessment
                </Button>
                <Button variant="outline" size="lg" href="#how-it-works">
                  See how it works
                </Button>
              </div>

              <p className="mt-6 text-xs text-ink-faint">
                Works in any modern browser · no downloads · ~15 minutes
              </p>
            </div>

            {/* Specimen report */}
            <div
              className="border border-rule bg-paper-raised animate-rise"
              style={{ animationDelay: "120ms" }}
            >
              <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                  Specimen report
                </p>
                <span className="stamp stamp--verified">Certified</span>
              </div>

              <div className="px-5 py-5">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                      Overall band
                    </p>
                    <p className="mt-1 font-display text-6xl font-medium leading-none tracking-tight text-ink">
                      7.5
                    </p>
                  </div>
                  <p className="pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                    Out of 9
                  </p>
                </div>

                <div className="mt-4">
                  <BandGauge band={7.5} size="md" />
                </div>

                <dl className="mt-6 divide-y divide-rule">
                  {criteria.map((c) => (
                    <div
                      key={c.label}
                      className="flex items-center justify-between gap-4 py-2.5"
                    >
                      <dt className="text-sm font-medium text-ink">
                        {c.label}
                      </dt>
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

                <p className="mt-5 border-t border-rule pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                  Marked by the FluentCheck jury
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Protocol */}
        <section id="how-it-works" className="border-t border-rule">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <div className="max-w-xl">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
                How it works
              </p>
              <h2 className="mt-4 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
                Four steps to your band
              </h2>
            </div>

            <div className="mt-12 grid gap-x-16 gap-y-0 sm:grid-cols-2">
              {protocol.map((step) => (
                <div
                  key={step.step}
                  className="flex gap-6 border-t border-rule py-8"
                >
                  <span className="font-display text-4xl font-medium leading-none text-ink-faint">
                    {step.step}
                  </span>
                  <div>
                    <h3 className="font-display text-xl font-medium tracking-tight text-ink">
                      {step.title}
                    </h3>
                    <p className="mt-2 max-w-md text-[15px] leading-7 text-ink-soft">
                      {step.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Fee sheet */}
        <section className="border-t border-rule bg-paper-raised">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
                The band scale
              </p>
              <h2 className="mt-4 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
                Scored on the band the world uses
              </h2>
              <p className="mt-4 max-w-md text-[15px] leading-7 text-ink-soft">
                Bands run from 0 to 9 in half steps. Most universities ask for
                6.5 or higher; employers use bands to shortlist quickly. Your
                report shows exactly where you stand in each skill.
              </p>

              <div className="mt-8 max-w-md">
                <BandGauge band={6.5} size="md" />
                <p className="mt-2 font-mono text-xs text-ink-faint">
                  Most universities & employers look for band 6.5 and above
                </p>
              </div>
            </div>

            <div className="border border-rule bg-paper">
              <div className="border-b border-rule px-5 py-3">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                  What your assessment includes
                </p>
              </div>
              <dl className="divide-y divide-rule">
                {[
                  ["Speaking test", "6–9 video prompts with prep time"],
                  ["Marking", "Two independent certified examiners"],
                  ["Report", "Band score and notes for every skill"],
                  ["Certificate", "Downloadable, shareable band report"],
                ].map(([term, desc]) => (
                  <div
                    key={term}
                    className="flex items-start justify-between gap-6 px-5 py-4"
                  >
                    <dt className="text-sm font-medium text-ink">{term}</dt>
                    <dd className="max-w-[16rem] text-right text-sm leading-6 text-ink-soft">
                      {desc}
                    </dd>
                  </div>
                ))}
                <div className="flex items-center justify-between px-5 py-4">
                  <dt className="font-display text-lg font-medium text-ink">
                    Fee
                  </dt>
                  <dd className="font-mono text-lg tabular-nums text-ink">
                    IDR 150,000
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* Final CTA — ink panel */}
        <section className="bg-ink">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-paper/60">
              Ready when you are
            </p>
            <h2 className="mx-auto mt-4 max-w-xl font-display text-3xl font-medium tracking-tight text-paper sm:text-4xl">
              Your first assessment takes about fifteen minutes.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-paper/70">
              All you need is a quiet room and a webcam. We check your camera
              and microphone before you begin.
            </p>
            <div className="mt-8 flex justify-center">
              <Button
                variant="invert"
                size="lg"
                href="/signup"
              >
                Start your assessment
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
