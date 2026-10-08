-- PRD v0.3.0 delivers five slots per Submission: Part 1 Task 1A, Part 1
-- Task 1B, Part 2, Part 3 and Part 4. Renaming the enum label maps every
-- legacy PART_1 Question, Manifest entry and Answer reference to PART_1A in
-- place, so retained Submissions stay readable without rewriting evidence.
-- New labels are added in their own migration so later migrations may use
-- them (PostgreSQL forbids using a new enum label in the transaction that
-- added it).
ALTER TYPE "QuestionCategory" RENAME VALUE 'PART_1' TO 'PART_1A';
ALTER TYPE "QuestionCategory" ADD VALUE IF NOT EXISTS 'PART_1B' AFTER 'PART_1A';
ALTER TYPE "QuestionCategory" ADD VALUE IF NOT EXISTS 'PART_4' AFTER 'PART_3';
