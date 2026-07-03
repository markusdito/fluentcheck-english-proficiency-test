import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center px-6 text-center">
        <div className="flex flex-col items-center gap-6">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-[var(--foreground)]">
            FluentCheck
          </h1>
          <p className="max-w-md text-lg leading-7 text-[var(--muted)]">
            Master your English speaking skills. Record video responses and
            receive expert feedback on pronunciation, fluency, and vocabulary.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 mt-4">
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-lg bg-[var(--primary)] px-8 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-dark)]"
            >
              Login
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-[var(--border)] bg-white px-8 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-zinc-50 dark:bg-transparent dark:hover:bg-zinc-900"
            >
              Register
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}