-- Group reassignment-history rows from one account transition so retries can
-- validate the exact map for that transition rather than every historical row.
ALTER TABLE "ExaminerAssignmentReassignment"
ADD COLUMN "transitionId" UUID;

-- Existing history predates batch identifiers. Give each row an isolated
-- legacy batch; new transitions always provide one shared identifier.
UPDATE "ExaminerAssignmentReassignment"
SET "transitionId" = md5("id"::text || ':legacy-transition')::uuid
WHERE "transitionId" IS NULL;

ALTER TABLE "ExaminerAssignmentReassignment"
ALTER COLUMN "transitionId" SET NOT NULL;

CREATE INDEX "ExaminerAssignmentReassignment_previousExaminerId_reason_createdAt_transitionId_idx"
ON "ExaminerAssignmentReassignment"("previousExaminerId", "reason", "createdAt", "transitionId");
