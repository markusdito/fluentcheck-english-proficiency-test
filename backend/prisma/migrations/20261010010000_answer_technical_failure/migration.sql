-- PRD FR-3.7/FR-3.8/FR-5.2: an Answer saved from a failed, short or silent
-- take keeps a technical-failure marker and reason. Existing rows are clean.
-- AlterTable
ALTER TABLE "Answer" ADD COLUMN     "technicalFailure" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "technicalFailureReason" TEXT;
