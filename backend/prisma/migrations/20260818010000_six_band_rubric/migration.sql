-- CreateEnum
CREATE TYPE "ScoringSystem" AS ENUM ('LEGACY_100', 'RUBRIC_6');

-- Add the scoring-system discriminator without applying the new default to historical rows.
ALTER TABLE "Submission" ADD COLUMN "scoringSystem" "ScoringSystem";

-- Preserve every submission that already has scoring evidence on the legacy scale.
UPDATE "Submission" AS submission
SET "scoringSystem" = CASE
  WHEN submission."status" IN ('SCORED', 'CERTIFIED')
    OR EXISTS (
      SELECT 1
      FROM "ExaminerAssignment" AS assignment
      INNER JOIN "Score" AS score ON score."assignmentId" = assignment."id"
      WHERE assignment."submissionId" = submission."id"
    )
    OR EXISTS (
      SELECT 1
      FROM "Certificate" AS certificate
      WHERE certificate."submissionId" = submission."id"
    )
  THEN 'LEGACY_100'::"ScoringSystem"
  ELSE 'RUBRIC_6'::"ScoringSystem"
END;

ALTER TABLE "Submission"
  ALTER COLUMN "scoringSystem" SET NOT NULL,
  ALTER COLUMN "scoringSystem" SET DEFAULT 'RUBRIC_6';

-- Store the four rubric marks while retaining the composite value for legacy reads.
ALTER TABLE "Score"
  ALTER COLUMN "value" TYPE DECIMAL(6,3),
  ADD COLUMN "pronunciation" DECIMAL(2,1),
  ADD COLUMN "fluency" DECIMAL(2,1),
  ADD COLUMN "vocabulary" DECIMAL(2,1),
  ADD COLUMN "grammar" DECIMAL(2,1);

-- A score is either fully legacy (no rubric fields) or has a complete valid rubric.
ALTER TABLE "Score" ADD CONSTRAINT "Score_rubric_complete_check" CHECK (
  (
    "pronunciation" IS NULL
    AND "fluency" IS NULL
    AND "vocabulary" IS NULL
    AND "grammar" IS NULL
  )
  OR
  (
    "pronunciation" BETWEEN 1.0 AND 6.0
    AND "fluency" BETWEEN 1.0 AND 6.0
    AND "vocabulary" BETWEEN 1.0 AND 6.0
    AND "grammar" BETWEEN 1.0 AND 6.0
    AND MOD("pronunciation", 0.5) = 0
    AND MOD("fluency", 0.5) = 0
    AND MOD("vocabulary", 0.5) = 0
    AND MOD("grammar", 0.5) = 0
  )
);
