import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/Stamp";

/**
 * One status primitive for submissions and assignments.
 *
 * Verdict moments (CERTIFIED / REC …) render as the bordered mono `Stamp`.
 * Everything else is an operational shadcn `Badge` with a data-tone.
 */
export function SubmissionStatus({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");

  if (status === "CERTIFIED") {
    return (
      <Stamp tone="verified" dot>
        {label}
      </Stamp>
    );
  }

  const tone =
    status === "AWAITING" ||
    status === "AWAITING_PAYMENT" ||
    status === "IN_PROGRESS" ||
    status === "SCORING" ||
    status === "ASSIGNED" ||
    status === "PENDING"
      ? "amber"
      : status === "FAILED" ||
          status === "FAILED_PAYMENT" ||
          status === "EXPIRED" ||
          status === "RETIRED"
        ? "signal"
        : status === "PAID" ||
            status === "SCORED" ||
            status === "COMPLETED" ||
            status === "VERIFIED"
          ? "verified"
          : "neutral";

  return (
    <Badge variant="outline" data-tone={tone}>
      {label}
    </Badge>
  );
}
