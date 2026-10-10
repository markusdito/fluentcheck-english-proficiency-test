-- PRD FR-7.3/FR-8.3: audited per-Submission payment waiver and the Admin's
-- note on a standalone reassignment. Existing rows are untouched.
-- AlterTable
ALTER TABLE "ExaminerAssignmentReassignment" ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "SubmissionPaymentWaiver" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionPaymentWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionPaymentWaiver_submissionId_key" ON "SubmissionPaymentWaiver"("submissionId");

-- CreateIndex
CREATE INDEX "SubmissionPaymentWaiver_adminId_idx" ON "SubmissionPaymentWaiver"("adminId");

-- AddForeignKey
ALTER TABLE "SubmissionPaymentWaiver" ADD CONSTRAINT "SubmissionPaymentWaiver_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPaymentWaiver" ADD CONSTRAINT "SubmissionPaymentWaiver_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
