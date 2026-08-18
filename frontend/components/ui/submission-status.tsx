import { Badge } from "@/components/ui/badge";

/**
 * Shared monochrome status primitive for submissions, payments, and assignments.
 */
export function SubmissionStatus({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");

  return <Badge variant="status">{label}</Badge>;
}
