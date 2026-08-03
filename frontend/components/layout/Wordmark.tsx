import Link from "next/link";
import { cn } from "@/lib/cn";

interface WordmarkProps {
  href?: string;
  dark?: boolean;
  className?: string;
}

export function Wordmark({ href = "/", dark = false, className }: WordmarkProps) {
  const mark = (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center font-display text-[15px] font-semibold leading-none tracking-tight",
        dark ? "bg-studio-text text-studio" : "bg-ink text-paper",
      )}
      aria-hidden="true"
    >
      F<i className="not-italic">C</i>
    </span>
  );

  const title = (
    <span
      className={cn(
        "font-display text-[19px] font-semibold leading-none tracking-tight",
        dark ? "text-studio-text" : "text-ink",
      )}
    >
      FluentCheck
    </span>
  );

  return (
    <Link
      href={href}
      className={cn("flex items-center gap-2.5", className)}
      aria-label="FluentCheck — home"
    >
      {mark}
      {title}
    </Link>
  );
}
