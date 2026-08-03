import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="border-t border-rule bg-paper">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <Wordmark />
          <div className="flex items-center gap-6">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
              Band Certification
            </span>
            <span className="text-xs text-ink-soft">
              &copy; {new Date().getFullYear()} FluentCheck
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
