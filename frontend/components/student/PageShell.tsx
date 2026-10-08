import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StudentNav } from "./StudentNav";
import { container, focusRing } from "./styles";

interface PageShellProps {
  name: string;
  email: string;
  label?: string;
  homeHref?: string;
  contentId: string;
  skipLabel: string;
  children: ReactNode;
}

/** SpeakNusa page frame: skip link, sticky nav, content column, footer. */
export function PageShell({ name, email, label, homeHref, contentId, skipLabel, children }: PageShellProps) {
  return (
    <div className="min-h-screen bg-sn-bg font-albert text-base leading-[1.55] text-sn-fg antialiased **:focus-visible:outline-offset-3! **:focus-visible:outline-sn-fg!">
      <a
        href={`#${contentId}`}
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-sn-fg focus:px-4 focus:py-2 focus:text-sn-surface"
      >
        {skipLabel}
      </a>
      <StudentNav name={name} email={email} label={label} homeHref={homeHref} />
      <main id={contentId} className={`${container} py-12`}>
        {children}
      </main>
      <footer className="mt-14 border-t border-sn-border py-14 text-[13px] text-sn-muted">
        <div className={container}>© 2026 SpeakNusa · English speaking assessment</div>
      </footer>
    </div>
  );
}

/** Ghost "back" link shown above a page title. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`-ml-2 inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-[15px] font-medium text-sn-fg transition-colors duration-200 hover:bg-sn-fg/6 ${focusRing}`}
    >
      <ArrowLeft className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
      {children}
    </Link>
  );
}

/** Full-page centred state (loading or error) in SpeakNusa style. */
export function PageState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sn-bg p-5 font-albert text-sn-fg">
      <div className="w-full max-w-sm text-center">{children}</div>
    </div>
  );
}
