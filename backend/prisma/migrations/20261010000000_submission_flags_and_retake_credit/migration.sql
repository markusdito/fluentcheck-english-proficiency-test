-- PRD FR-2.2/FR-2.9: flag review, terminal VOIDED, and one free retake
-- credit per voided Submission. Existing rows are untouched.
-- CreateEnum
CREATE TYPE "SubmissionFlagType" AS ENUM ('TECHNICAL_FAILURE', 'CAMERA_DROP', 'INTEGRITY_CONCERN');

-- CreateEnum
CREATE TYPE "SubmissionFlagSource" AS ENUM ('STUDENT_DEVICE', 'EXAMINER');

-- CreateEnum
CREATE TYPE "SubmissionFlagResolution" AS ENUM ('CONFIRMED', 'DISMISSED', 'SUPERSEDED');

-- AlterEnum


ALTER TYPE "SubmissionStatus" ADD VALUE 'FLAG_REVIEW';
ALTER TYPE "SubmissionStatus" ADD VALUE 'VOIDED';

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "flagReturnStatus" "SubmissionStatus";

-- CreateTable
CREATE TABLE "SubmissionFlag" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "type" "SubmissionFlagType" NOT NULL,
    "source" "SubmissionFlagSource" NOT NULL,
    "reason" TEXT NOT NULL,
    "answerId" UUID,
    "manifestEntryId" UUID,
    "timestampSeconds" INTEGER,
    "raisedById" UUID,
    "raisedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" "SubmissionFlagResolution",
    "resolutionNote" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ,

    CONSTRAINT "SubmissionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetakeCredit" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "voidedSubmissionId" UUID NOT NULL,
    "redeemedSubmissionId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMPTZ,

    CONSTRAINT "RetakeCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionFlag_submissionId_resolution_idx" ON "SubmissionFlag"("submissionId", "resolution");

-- CreateIndex
CREATE INDEX "SubmissionFlag_resolution_raisedAt_idx" ON "SubmissionFlag"("resolution", "raisedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetakeCredit_voidedSubmissionId_key" ON "RetakeCredit"("voidedSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RetakeCredit_redeemedSubmissionId_key" ON "RetakeCredit"("redeemedSubmissionId");

-- CreateIndex
CREATE INDEX "RetakeCredit_studentId_redeemedSubmissionId_idx" ON "RetakeCredit"("studentId", "redeemedSubmissionId");

-- AddForeignKey
ALTER TABLE "SubmissionFlag" ADD CONSTRAINT "SubmissionFlag_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFlag" ADD CONSTRAINT "SubmissionFlag_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFlag" ADD CONSTRAINT "SubmissionFlag_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFlag" ADD CONSTRAINT "SubmissionFlag_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetakeCredit" ADD CONSTRAINT "RetakeCredit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetakeCredit" ADD CONSTRAINT "RetakeCredit_voidedSubmissionId_fkey" FOREIGN KEY ("voidedSubmissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetakeCredit" ADD CONSTRAINT "RetakeCredit_redeemedSubmissionId_fkey" FOREIGN KEY ("redeemedSubmissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

