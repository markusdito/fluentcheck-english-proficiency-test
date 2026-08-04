import { cn } from "@/lib/cn";

export type StampTone = "ink" | "verified" | "signal";

interface StampProps {
  tone?: StampTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Bordered uppercase mono pill — reads like an acceptance, rejection,
 * or certification stamp on an exam document.
 */
export function Stamp({
  tone = "ink",
  dot = false,
  children,
  className,
}: StampProps) {
  return (
    <span className={cn("stamp", `stamp--${tone}`, className)}>
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current"
        />
      )}
      {children}
    </span>
  );
}
