-- PRD 0.3.1 FR-9.1: each Examiner gives one Score for the whole Submission.
-- That Score has no Answer. Per-Answer Scores from earlier Submissions are kept
-- as-is and stay readable.
ALTER TABLE "Score" ALTER COLUMN "answerId" DROP NOT NULL;

CREATE UNIQUE INDEX "Score_assignmentId_key"
    ON "Score" ("assignmentId")
    WHERE "answerId" IS NULL;
