-- Expansion stage of the fixed-slot cutover (ADR 0008): slots are optional so
-- existing assignment writers keep working until the writer migration lands.
-- Valid historical two-assignment sets are backfilled deterministically by
-- creation time and then stable identity. Partial, excess, or
-- lifecycle-inconsistent sets fail the migration for explicit reconciliation —
-- the preflight reports them and this migration never fabricates or deletes
-- scoring evidence.

ALTER TABLE "ExaminerAssignment" ADD COLUMN "slot" INTEGER;

-- Only the two fixed slot identities may be populated.
ALTER TABLE "ExaminerAssignment"
  ADD CONSTRAINT "ExaminerAssignment_slot_permitted"
  CHECK ("slot" IS NULL OR "slot" IN (1, 2));

-- One Examiner cannot occupy both assignments for the same Submission, and a
-- populated slot cannot repeat. Partial unique indexes keep unpopulated rows
-- (legacy writers) valid during the expansion stage.
CREATE UNIQUE INDEX "ExaminerAssignment_submissionId_populated_slot_key"
ON "ExaminerAssignment" ("submissionId", "slot")
WHERE "slot" IS NOT NULL;

-- Backfill valid historical two-assignment sets deterministically: creation
-- time first, then stable identity as the tiebreaker. Only sets of exactly two
-- distinct assignments in a scoring-compatible lifecycle are adopted; every
-- other shape fails the migration below.
WITH candidate AS (
    SELECT a."id",
           a."submissionId",
           ROW_NUMBER() OVER (
               PARTITION BY a."submissionId"
               ORDER BY a."createdAt", a."id"
           ) AS "position",
           COUNT(*) OVER (PARTITION BY a."submissionId") AS "assignmentCount"
      FROM "ExaminerAssignment" a
),
compatible AS (
    SELECT c."submissionId"
      FROM "Submission" s
      JOIN candidate c ON c."submissionId" = s."id"
     WHERE c."assignmentCount" = 2
       AND s."status" IN ('SCORING', 'SCORED', 'CERTIFIED')
     GROUP BY c."submissionId"
    HAVING COUNT(c."id") = 2
)
UPDATE "ExaminerAssignment" a
   SET "slot" = c."position"
  FROM candidate c
  JOIN compatible ON compatible."submissionId" = c."submissionId"
 WHERE a."id" = c."id";

-- Fail closed on every set the backfill could not adopt: one-assignment,
-- excess-assignment, or lifecycle-inconsistent state requires operator
-- reconciliation before enforcement can proceed.
DO $$
DECLARE
    irregular_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO irregular_count
      FROM (
          SELECT a."submissionId"
            FROM "ExaminerAssignment" a
            JOIN "Submission" s ON s."id" = a."submissionId"
           GROUP BY a."submissionId"
          HAVING COUNT(*) <> 2
              OR COUNT(*) FILTER (WHERE a."slot" IS NULL) > 0
      ) irregular;

    IF irregular_count > 0 THEN
        RAISE EXCEPTION
          'Irregular Examiner assignment sets found; run the assignment preflight and reconcile before migrating (%)',
          irregular_count
          USING ERRCODE = '23514';
    END IF;
END;
$$;
