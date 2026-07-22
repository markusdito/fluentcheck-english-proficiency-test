import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--foreground)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2a3 3 0 00-3 3v1H7a3 3 0 00-3 3v1a3 3 0 000 6v1a3 3 0 003 3h2v1a3 3 0 006 0v-1h2a3 3 0 003-3v-1a3 3 0 000-6v-1a3 3 0 00-3-3h-2V5a3 3 0 00-3-3z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </span>
            FluentCheck
          </Link>

          <nav className="flex items-center gap-4" aria-label="Main navigation">
            <Link
              href="/login"
              className="text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-5 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-dark)]"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero section */}
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-20 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl lg:text-6xl">
              Master your English speaking skills
            </h1>
            <p className="mt-6 text-lg leading-8 text-[var(--muted)] sm:text-xl">
              Record video responses to expert-crafted prompts and receive
              detailed feedback from our jury of language professionals.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[var(--primary)] px-8 text-sm font-medium text-white shadow-lg shadow-blue-500/25 transition-all hover:bg-[var(--primary-dark)] hover:shadow-blue-500/30 sm:w-auto"
              >
                Start your assessment
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-[var(--border)] bg-white px-8 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-zinc-50 sm:w-auto"
              >
                Sign in to your account
              </Link>
            </div>
          </div>
        </section>

        {/* Features section */}
        <section className="border-t border-[var(--border)] bg-white">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-[var(--foreground)]">
                Why FluentCheck?
              </h2>
              <p className="mt-4 text-lg text-[var(--muted)]">
                Everything you need to improve your English speaking proficiency.
              </p>
            </div>

            <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  title: "Expert-crafted prompts",
                  description:
                    "Practice with real-world scenarios designed by language assessment professionals to test your true speaking ability.",
                  icon: (
                    <path
                      fillRule="evenodd"
                      d="M12 2a3 3 0 00-3 3v1H7a3 3 0 00-3 3v1a3 3 0 000 6v1a3 3 0 003 3h2v1a3 3 0 006 0v-1h2a3 3 0 003-3v-1a3 3 0 000-6v-1a3 3 0 00-3-3h-2V5a3 3 0 00-3-3z"
                      clipRule="evenodd"
                    />
                  ),
                },
                {
                  title: "Video recording",
                  description:
                    "Record your responses using your webcam and microphone. Our browser-based recorder works on any device, no downloads needed.",
                  icon: (
                    <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" />
                  ),
                },
                {
                  title: "Expert jury feedback",
                  description:
                    "Receive detailed evaluations from certified language experts on pronunciation, fluency, vocabulary, and grammar.",
                  icon: (
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                      clipRule="evenodd"
                    />
                  ),
                },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-xl border border-[var(--border)] bg-white p-8 transition-shadow hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-[var(--primary)]">
                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      {feature.icon}
                    </svg>
                  </div>
                  <h3 className="mt-6 text-lg font-semibold text-[var(--foreground)]">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA section */}
        <section className="bg-gradient-to-br from-[var(--primary)] via-blue-700 to-indigo-800">
          <div className="mx-auto max-w-4xl px-6 py-20 text-center sm:py-24">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Ready to improve your English?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-blue-100">
              Join thousands of test-takers who have enhanced their speaking
              skills with FluentCheck.
            </p>
            <Link
              href="/signup"
              className="mt-10 inline-flex h-12 items-center justify-center rounded-lg bg-white px-8 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-blue-50"
            >
              Create your free account
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-white py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-white">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 2a3 3 0 00-3 3v1H7a3 3 0 00-3 3v1a3 3 0 000 6v1a3 3 0 003 3h2v1a3 3 0 006 0v-1h2a3 3 0 003-3v-1a3 3 0 000-6v-1a3 3 0 00-3-3h-2V5a3 3 0 00-3-3z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </span>
              FluentCheck
            </div>
            <p className="text-sm text-[var(--muted)]">
              &copy; {new Date().getFullYear()} FluentCheck. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}