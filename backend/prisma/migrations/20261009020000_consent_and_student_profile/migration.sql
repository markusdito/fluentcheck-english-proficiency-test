-- PRD FR-1.4: student profile holds full name and Student ID for the identity clip.
ALTER TABLE "User" ADD COLUMN "fullName" TEXT;
ALTER TABLE "User" ADD COLUMN "studentNumber" TEXT;

-- PRD FR-2.6: each Submission records informed consent before any capture.
-- Legacy Submissions predate consent recording and keep NULL.
ALTER TABLE "Submission" ADD COLUMN "consentedAt" TIMESTAMPTZ;
ALTER TABLE "Submission" ADD COLUMN "consentVersion" TEXT;
