import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="border-t border-rule bg-paper">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex items-center justify-between gap-3 sm:gap-6">
          <Wordmark className="gap-0 [&>span:last-child]:hidden sm:gap-2.5 sm:[&>span:last-child]:inline" />
          <div className="flex items-center gap-3 whitespace-nowrap sm:gap-6">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint sm:text-xs sm:tracking-[0.14em]">
              Band Certification
            </span>
            <span className="text-[10px] text-ink-soft sm:text-xs">
              &copy; {new Date().getFullYear()} FluentCheck
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
