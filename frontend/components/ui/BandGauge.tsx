import { cn } from "@/lib/cn";

interface BandGaugeProps {
  band: number;
  max?: number;
  showValue?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const cellHeights: Record<NonNullable<BandGaugeProps["size"]>, string> = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-3.5",
};

/**
 * The signature artifact: a segmented band gauge with half-band support.
 * Cells fill with ink; a half band renders as a half-filled cell.
 */
export function BandGauge({
  band,
  max = 6,
  showValue = true,
  size = "md",
  className,
}: BandGaugeProps) {
  const clamped = Math.min(Math.max(band, 0), max);
  const fullCells = Math.floor(clamped);
  const hasHalf = clamped % 1 !== 0;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex flex-1 gap-[2px]" role="img" aria-label={`Band ${clamped} of ${max}`}>
        {Array.from({ length: max }, (_, i) => {
          const filled = i < fullCells;
          const half = hasHalf && i === fullCells;
          return (
            <div
              key={i}
              aria-hidden="true"
              className={cn(
                "relative flex-1 overflow-hidden rounded-[1px]",
                cellHeights[size],
                filled ? "bg-ink" : half ? "bg-rule-strong/40" : "bg-rule",
              )}
            >
              {half && (
                <div className="absolute inset-y-0 left-0 w-1/2 rounded-[1px] bg-ink" />
              )}
            </div>
          );
        })}
      </div>
      {showValue && (
        <span
          className={cn(
            "font-mono tabular-nums tracking-tight",
            size === "sm" ? "text-xs" : size === "lg" ? "text-xl" : "text-sm",
          )}
        >
          {clamped}
          <span className="text-ink-faint">/{max}</span>
        </span>
      )}
    </div>
  );
}
