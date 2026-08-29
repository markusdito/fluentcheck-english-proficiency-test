-- Final stage of the fixed-slot cutover (ADR 0008). The expansion stage
-- remains the gate for historical cardinality and lifecycle conflicts; this
-- stage refuses to proceed if any writer left an assignment unpopulated.
DO $$
DECLARE
    invalid_slot_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_slot_count
      FROM "ExaminerAssignment"
     WHERE "slot" IS NULL OR "slot" NOT IN (1, 2);

    IF invalid_slot_count > 0 THEN
        RAISE EXCEPTION
          'Unpopulated or invalid Examiner assignment slots found; rerun the assignment preflight before enforcing required slots (%)',
          invalid_slot_count
          USING ERRCODE = '23514';
    END IF;
END;
$$;

-- Replace the expansion-stage partial uniqueness guard with the final
-- non-partial uniqueness constraint. Together with the slot check and NOT
-- NULL column, only one assignment can occupy each of the two slots.
DROP INDEX "ExaminerAssignment_submissionId_populated_slot_key";

ALTER TABLE "ExaminerAssignment"
  ALTER COLUMN "slot" SET NOT NULL;

CREATE UNIQUE INDEX "ExaminerAssignment_submissionId_slot_key"
ON "ExaminerAssignment" ("submissionId", "slot");
