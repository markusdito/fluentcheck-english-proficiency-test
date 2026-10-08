-- A Test Set replaces the implicit integer Question `order`: it holds exactly
-- one active Question per delivery slot, and a version 2 Submission manifest
-- snapshots the single Test Set it was delivered from.
BEGIN;

CREATE TABLE "TestSet" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TestSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestSet_code_key" ON "TestSet"("code");

-- Every legacy question-set order becomes its own Test Set. Retired
-- Questions keep their historical grouping alongside active ones.
INSERT INTO "TestSet" ("id", "code", "updatedAt")
SELECT gen_random_uuid(), 'LEGACY-' || legacy."order", CURRENT_TIMESTAMP
  FROM (SELECT DISTINCT "order" FROM "Question") legacy;

ALTER TABLE "Question" ADD COLUMN "testSetId" UUID;

UPDATE "Question" AS q
   SET "testSetId" = t."id"
  FROM "TestSet" AS t
 WHERE t."code" = 'LEGACY-' || q."order";

ALTER TABLE "Question" ALTER COLUMN "testSetId" SET NOT NULL;

-- Active-position uniqueness moves from category/order to Test Set/slot.
-- Legacy active positions were unique per category/order, so the new index
-- cannot conflict.
DROP INDEX "Question_category_order_key";
ALTER TABLE "Question" DROP COLUMN "order";

CREATE UNIQUE INDEX "Question_testSetId_category_key"
    ON "Question" ("testSetId", "category")
    WHERE "deletedAt" IS NULL;

ALTER TABLE "Question"
ADD CONSTRAINT "Question_testSetId_fkey"
FOREIGN KEY ("testSetId") REFERENCES "TestSet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy (version 1) manifests stay without a Test Set: their evidence is
-- immutable and is never reconstructed from the current Question bank.
ALTER TABLE "SubmissionManifest"
ADD COLUMN "testSetId" UUID,
ADD COLUMN "testSetCode" TEXT;

CREATE INDEX "SubmissionManifest_testSetId_idx" ON "SubmissionManifest"("testSetId");

ALTER TABLE "SubmissionManifest"
ADD CONSTRAINT "SubmissionManifest_testSetId_fkey"
FOREIGN KEY ("testSetId") REFERENCES "TestSet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubmissionManifest"
ADD CONSTRAINT "SubmissionManifest_test_set_check"
CHECK (
    "version" <> 2
    OR ("testSetId" IS NOT NULL AND "testSetCode" IS NOT NULL AND "testSetCode" <> '')
);

-- Version 1 keeps its legacy three-slot shape under the renamed label.
CREATE OR REPLACE FUNCTION submission_manifest_v1_has_exact_shape(target_manifest_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COUNT(*) = 3
       AND COUNT(*) FILTER (WHERE "category" = 'PART_1A') = 1
       AND COUNT(*) FILTER (WHERE "category" = 'PART_2') = 1
       AND COUNT(*) FILTER (WHERE "category" = 'PART_3') = 1
       AND COUNT(*) FILTER (WHERE "deliveryPosition" = 1) = 1
       AND COUNT(*) FILTER (WHERE "deliveryPosition" = 2) = 1
       AND COUNT(*) FILTER (WHERE "deliveryPosition" = 3) = 1
      FROM "ManifestEntry"
     WHERE "manifestId" = target_manifest_id;
$$;

-- Version 2 delivers every slot exactly once in the fixed order
-- 1A -> 1B -> 2 -> 3 -> 4.
CREATE FUNCTION submission_manifest_v2_has_exact_shape(target_manifest_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COUNT(*) = 5
       AND COUNT(*) FILTER (WHERE "category" = 'PART_1A' AND "deliveryPosition" = 1) = 1
       AND COUNT(*) FILTER (WHERE "category" = 'PART_1B' AND "deliveryPosition" = 2) = 1
       AND COUNT(*) FILTER (WHERE "category" = 'PART_2' AND "deliveryPosition" = 3) = 1
       AND COUNT(*) FILTER (WHERE "category" = 'PART_3' AND "deliveryPosition" = 4) = 1
       AND COUNT(*) FILTER (WHERE "category" = 'PART_4' AND "deliveryPosition" = 5) = 1
      FROM "ManifestEntry"
     WHERE "manifestId" = target_manifest_id;
$$;

CREATE OR REPLACE FUNCTION enforce_submission_manifest_v1_shape()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_manifest_id UUID;
    target_submission_id UUID;
    target_version INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'SubmissionManifest' THEN
        target_manifest_id := COALESCE(NEW."id", OLD."id");
        target_submission_id := COALESCE(NEW."submissionId", OLD."submissionId");
    ELSE
        target_manifest_id := COALESCE(NEW."manifestId", OLD."manifestId");
        target_submission_id := COALESCE(NEW."submissionId", OLD."submissionId");
    END IF;

    IF TG_OP = 'DELETE' AND retention_purge_is_authorized(target_submission_id) THEN
        RETURN NULL;
    END IF;

    SELECT "version"
      INTO target_version
      FROM "SubmissionManifest"
     WHERE "id" = target_manifest_id;

    IF target_version = 1 AND NOT submission_manifest_v1_has_exact_shape(target_manifest_id) THEN
        RAISE EXCEPTION
          'Submission manifest version 1 must contain exactly PART_1A, PART_2, PART_3 at positions 1, 2, 3'
          USING ERRCODE = '23514';
    END IF;

    IF target_version = 2 AND NOT submission_manifest_v2_has_exact_shape(target_manifest_id) THEN
        RAISE EXCEPTION
          'Submission manifest version 2 must contain exactly PART_1A, PART_1B, PART_2, PART_3, PART_4 at positions 1, 2, 3, 4, 5'
          USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

-- New Submissions are delivered from one Test Set across all five slots.
-- Existing version 1 rows stay as retained Legacy evidence.
CREATE OR REPLACE FUNCTION enforce_manifest_on_new_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    manifest_id UUID;
    manifest_version INTEGER;
BEGIN
    SELECT "id", "version"
      INTO manifest_id, manifest_version
      FROM "SubmissionManifest"
     WHERE "submissionId" = NEW."id";

    IF manifest_version IS DISTINCT FROM 2
       OR NOT submission_manifest_v2_has_exact_shape(manifest_id) THEN
        RAISE EXCEPTION
          'New Submission must have a complete version-2 manifest'
          USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

COMMIT;
