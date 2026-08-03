import { cn } from "@/lib/cn";
import { Wordmark } from "./Wordmark";

interface HeaderProps {
  nav?: React.ReactNode;
  actions?: React.ReactNode;
  logoHref?: string;
  className?: string;
}

/**
 * Shared masthead — sticky paper bar with a bottom rule, used by every
 * authenticated surface. Children slot the role-specific nav / actions.
 */
export function Header({ nav, actions, logoHref = "/", className }: HeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-rule bg-paper/90 backdrop-blur-sm",
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Wordmark href={logoHref} />
        {nav ? <div className="flex min-w-0 items-center">{nav}</div> : null}
        {actions ? <div className="flex items-center gap-4">{actions}</div> : null}
      </div>
    </header>
  );
}
