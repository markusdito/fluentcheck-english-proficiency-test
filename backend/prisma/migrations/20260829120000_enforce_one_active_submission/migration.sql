-- A student may have at most one resumable attempt. Historical non-active
-- submissions remain untouched; duplicate active rows fail the migration so
-- they must be resolved by the manifest preflight first.
CREATE UNIQUE INDEX "Submission_one_active_per_student_key"
ON "Submission" ("studentId")
WHERE "status" = 'IN_PROGRESS';
