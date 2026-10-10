-- Align migration history with schema.prisma: Prisma manages updatedAt via
-- @updatedAt (no DB default), and Postgres truncated the long reassignment
-- index name to 63 chars, so rename it to the name Prisma expects.

-- AlterTable
ALTER TABLE "GoogleOAuthState" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PromptMediaCleanupObject" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SubmissionPurgeObject" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SubmissionPurgeRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "ExaminerAssignmentReassignment_previousExaminerId_reason_create" RENAME TO "ExaminerAssignmentReassignment_previousExaminerId_reason_cr_idx";
