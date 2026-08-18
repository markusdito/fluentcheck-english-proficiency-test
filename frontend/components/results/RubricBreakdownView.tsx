import { RUBRIC_CRITERIA, type RubricBreakdown } from "@/types/scoring";
import { cn } from "@/lib/utils";

interface RubricBreakdownViewProps {
  rubric: RubricBreakdown;
  className?: string;
  compact?: boolean;
}

const LABELS: Record<(typeof RUBRIC_CRITERIA)[number], string> = {
  pronunciation: "Pronunciation",
  fluency: "Fluency",
  vocabulary: "Vocabulary",
  grammar: "Grammar",
};

export function RubricBreakdownView({
  rubric,
  className,
  compact = false,
}: RubricBreakdownViewProps) {
  return (
    <dl
      className={cn(
        "grid border-y border-rule sm:grid-cols-2",
        className,
      )}
    >
      {RUBRIC_CRITERIA.map((criterion, index) => (
        <div
          key={criterion}
          className={cn(
            "flex items-center justify-between gap-4 py-2.5",
            index % 2 === 0 ? "sm:pr-4" : "sm:border-l sm:border-rule sm:pl-4",
            index < 2 && "border-b border-rule",
            index === 1 && "sm:border-b",
            index === 2 && "border-b border-rule sm:border-b-0",
            compact ? "px-0" : "px-3 sm:px-0",
          )}
        >
          <dt className="text-xs text-ink-soft">{LABELS[criterion]}</dt>
          <dd className="font-mono text-sm font-semibold tabular-nums text-ink">
            {rubric[criterion].toFixed(2)}
            <span className="font-normal text-ink-faint">/6</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
