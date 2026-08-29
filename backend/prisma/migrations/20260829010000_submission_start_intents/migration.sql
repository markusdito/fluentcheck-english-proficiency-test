ALTER TYPE "SubmissionStatus" ADD VALUE IF NOT EXISTS 'ABANDONED';

CREATE TABLE "SubmissionStartIntent" (
    "idempotencyKey" TEXT NOT NULL,
    "studentId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubmissionStartIntent_pkey" PRIMARY KEY ("idempotencyKey"),
    CONSTRAINT "SubmissionStartIntent_submissionId_key" UNIQUE ("submissionId"),
    CONSTRAINT "SubmissionStartIntent_studentId_idempotencyKey_key" UNIQUE ("studentId", "idempotencyKey"),
    CONSTRAINT "SubmissionStartIntent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SubmissionStartIntent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SubmissionStartIntent_studentId_idx" ON "SubmissionStartIntent"("studentId");
