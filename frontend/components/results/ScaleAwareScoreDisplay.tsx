import type { ScaleAwareScore } from "@/lib/dashboard-api";
import { BandGauge } from "@/components/ui/BandGauge";

interface ScaleAwareScoreDisplayProps {
  score: ScaleAwareScore;
}

export function ScaleAwareScoreDisplay({ score }: ScaleAwareScoreDisplayProps) {
  if (score.scoringSystem === "RUBRIC_6") {
    return <BandGauge band={score.value} max={6} size="md" />;
  }

  return (
    <div>
      <p className="font-mono text-xl font-semibold tabular-nums text-ink">
        {score.value}
        <span className="text-sm font-normal text-ink-faint">/100</span>
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        Legacy score
      </p>
    </div>
  );
}
