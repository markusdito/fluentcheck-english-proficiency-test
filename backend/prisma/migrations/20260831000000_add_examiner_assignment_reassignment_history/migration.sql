-- Preserve every ownership transfer as append-only operational history.
-- Assignment rows retain their identity and evidence; this table records only
-- who changed and why.
CREATE TABLE "ExaminerAssignmentReassignment" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "previousExaminerId" UUID NOT NULL,
    "newExaminerId" UUID NOT NULL,
    "actingAdminId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExaminerAssignmentReassignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExaminerAssignmentReassignment_assignmentId_createdAt_idx"
ON "ExaminerAssignmentReassignment"("assignmentId", "createdAt");

CREATE INDEX "ExaminerAssignmentReassignment_previousExaminerId_idx"
ON "ExaminerAssignmentReassignment"("previousExaminerId");

CREATE INDEX "ExaminerAssignmentReassignment_newExaminerId_idx"
ON "ExaminerAssignmentReassignment"("newExaminerId");

CREATE INDEX "ExaminerAssignmentReassignment_actingAdminId_idx"
ON "ExaminerAssignmentReassignment"("actingAdminId");

ALTER TABLE "ExaminerAssignmentReassignment"
ADD CONSTRAINT "ExaminerAssignmentReassignment_assignmentId_fkey"
FOREIGN KEY ("assignmentId") REFERENCES "ExaminerAssignment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExaminerAssignmentReassignment"
ADD CONSTRAINT "ExaminerAssignmentReassignment_previousExaminerId_fkey"
FOREIGN KEY ("previousExaminerId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExaminerAssignmentReassignment"
ADD CONSTRAINT "ExaminerAssignmentReassignment_newExaminerId_fkey"
FOREIGN KEY ("newExaminerId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExaminerAssignmentReassignment"
ADD CONSTRAINT "ExaminerAssignmentReassignment_actingAdminId_fkey"
FOREIGN KEY ("actingAdminId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_examiner_assignment_reassignment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
      'Examiner assignment reassignment history is immutable: % on %',
      TG_OP, TG_TABLE_NAME
      USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "ExaminerAssignmentReassignment_immutable"
BEFORE UPDATE OR DELETE ON "ExaminerAssignmentReassignment"
FOR EACH ROW
EXECUTE FUNCTION reject_examiner_assignment_reassignment_mutation();
