# Block new Assessments while a Submission is in the review pipeline

Status: Superseded (#164) — PRD v0.3.0 FR-2.3/FR-2.5 allow a retake at any time. The `SUBMISSION_IN_REVIEW` check and the dashboard notice were removed; only the single `IN_PROGRESS` rule remains. Each Submission keeps its own payment or waiver.

A student may hold at most one Submission that is not yet Scored or Abandoned. The existing single-Active-Submission rule (`IN_PROGRESS`) only covers recording; without this decision a student could record a second Submission while the first was still moving through payment and Examiner scoring, producing two parallel scoring pipelines for one student.

Starting a new Assessment is now refused while a Review-pipeline submission exists — `AWAITING_PAYMENT`, `PAID`, or `SCORING`. The backend enforces this during manifest initialization with a typed `SUBMISSION_IN_REVIEW` conflict (HTTP 409), and the student dashboard surfaces the same rule with a notice before the permission flow begins. Once the Submission reaches `SCORED` (or is Abandoned), a new Assessment may start.

The dashboard history excludes Active Submissions but includes review-pipeline rows, so the client can detect the blocked state from the newest history row; the server remains authoritative if the client check is bypassed. Abandonment remains the student's explicit escape hatch for unfinished attempts, and scoring completion is the only transition that re-enables starting.
