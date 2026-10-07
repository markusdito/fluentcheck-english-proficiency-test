import Link from "next/link";
import { cn } from "@/lib/cn";

interface WordmarkProps {
  href?: string;
  dark?: boolean;
  iconOnly?: boolean;
  className?: string;
}

export function Wordmark({
  href = "/",
  dark = false,
  iconOnly = false,
  className,
}: WordmarkProps) {
  const mark = (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center font-display text-[15px] font-semibold leading-none tracking-tight",
        dark ? "bg-studio-text text-studio" : "bg-ink text-paper",
      )}
      aria-hidden="true"
    >
      S<i className="not-italic">N</i>
    </span>
  );

  const title = (
    <span
      className={cn(
        "text-[19px] font-normal lowercase leading-none tracking-tight",
        dark ? "text-studio-text" : "text-ink",
      )}
    >
      <b className="font-bold">speak</b>nusa
    </span>
  );

  return (
    <Link
      href={href}
      className={cn("flex items-center gap-2.5", className)}
      aria-label="SpeakNusa — home"
    >
      {mark}
      {iconOnly ? null : title}
    </Link>
  );
}
