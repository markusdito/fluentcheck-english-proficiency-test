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
        "grid border-y border-sn-border sm:grid-cols-2",
        className,
      )}
    >
      {RUBRIC_CRITERIA.map((criterion, index) => (
        <div
          key={criterion}
          className={cn(
            "flex items-center justify-between gap-4 py-2.5",
            index % 2 === 0 ? "sm:pr-4" : "sm:border-l sm:border-sn-border sm:pl-4",
            index < 2 && "border-b border-sn-border",
            index === 1 && "sm:border-b",
            index === 2 && "border-b border-sn-border sm:border-b-0",
            compact ? "px-0" : "px-3 sm:px-0",
          )}
        >
          <dt className="text-xs text-sn-muted">{LABELS[criterion]}</dt>
          <dd className="text-sm font-semibold tabular-nums text-sn-fg">
            {rubric[criterion].toFixed(2)}
            <span className="font-normal text-sn-muted">/6</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
