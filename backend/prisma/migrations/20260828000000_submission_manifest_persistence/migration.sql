-- Add the relational Submission-manifest boundary without fabricating history.
-- Existing Submissions remain Legacy Submissions because they have no manifest row.

ALTER TABLE "Answer"
ALTER COLUMN "questionId" DROP NOT NULL,
ADD COLUMN "manifestEntryId" UUID;

CREATE TABLE "SubmissionManifest" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionManifest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubmissionManifest_version_check" CHECK ("version" > 0)
);

CREATE TABLE "ManifestEntry" (
    "id" UUID NOT NULL,
    "manifestId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "deliveryPosition" INTEGER NOT NULL,
    "sourceQuestionId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManifestEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ManifestEntry_deliveryPosition_check"
      CHECK ("deliveryPosition" BETWEEN 1 AND 3)
);

CREATE TABLE "ManifestTask" (
    "id" UUID NOT NULL,
    "manifestEntryId" UUID NOT NULL,
    "sourceTaskId" UUID NOT NULL,
    "sourceQuestionId" UUID NOT NULL,
    "deliveredOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManifestTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ManifestTask_deliveredOrder_check" CHECK ("deliveredOrder" > 0)
);

CREATE UNIQUE INDEX "SubmissionManifest_submissionId_key"
ON "SubmissionManifest"("submissionId");

CREATE UNIQUE INDEX "SubmissionManifest_id_submissionId_key"
ON "SubmissionManifest"("id", "submissionId");

CREATE UNIQUE INDEX "ManifestEntry_id_submissionId_key"
ON "ManifestEntry"("id", "submissionId");

CREATE UNIQUE INDEX "ManifestEntry_id_sourceQuestionId_key"
ON "ManifestEntry"("id", "sourceQuestionId");

CREATE UNIQUE INDEX "ManifestEntry_manifestId_category_key"
ON "ManifestEntry"("manifestId", "category");

CREATE UNIQUE INDEX "ManifestEntry_manifestId_deliveryPosition_key"
ON "ManifestEntry"("manifestId", "deliveryPosition");

CREATE INDEX "ManifestEntry_sourceQuestionId_idx"
ON "ManifestEntry"("sourceQuestionId");

CREATE UNIQUE INDEX "ManifestTask_manifestEntryId_sourceTaskId_key"
ON "ManifestTask"("manifestEntryId", "sourceTaskId");

CREATE UNIQUE INDEX "ManifestTask_manifestEntryId_deliveredOrder_key"
ON "ManifestTask"("manifestEntryId", "deliveredOrder");

CREATE INDEX "ManifestTask_sourceTaskId_idx"
ON "ManifestTask"("sourceTaskId");

CREATE UNIQUE INDEX "Task_id_questionId_key"
ON "Task"("id", "questionId");

CREATE UNIQUE INDEX "Answer_manifestEntryId_key"
ON "Answer"("manifestEntryId");

ALTER TABLE "SubmissionManifest"
ADD CONSTRAINT "SubmissionManifest_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "Submission"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManifestEntry"
ADD CONSTRAINT "ManifestEntry_manifestId_submissionId_fkey"
FOREIGN KEY ("manifestId", "submissionId")
REFERENCES "SubmissionManifest"("id", "submissionId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManifestEntry"
ADD CONSTRAINT "ManifestEntry_sourceQuestionId_fkey"
FOREIGN KEY ("sourceQuestionId") REFERENCES "Question"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManifestTask"
ADD CONSTRAINT "ManifestTask_manifestEntryId_sourceQuestionId_fkey"
FOREIGN KEY ("manifestEntryId", "sourceQuestionId")
REFERENCES "ManifestEntry"("id", "sourceQuestionId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManifestTask"
ADD CONSTRAINT "ManifestTask_sourceTaskId_sourceQuestionId_fkey"
FOREIGN KEY ("sourceTaskId", "sourceQuestionId")
REFERENCES "Task"("id", "questionId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Answer"
ADD CONSTRAINT "Answer_identity_check"
CHECK (num_nonnulls("questionId", "manifestEntryId") = 1);

ALTER TABLE "Answer"
ADD CONSTRAINT "Answer_manifestEntryId_submissionId_fkey"
FOREIGN KEY ("manifestEntryId", "submissionId")
REFERENCES "ManifestEntry"("id", "submissionId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Version 1 is complete only when all three Required categories and positions
-- exist. The check is deferred so callers can build the relational aggregate in
-- any order inside one transaction while an incomplete commit still fails.
CREATE FUNCTION enforce_submission_manifest_v1_shape()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_manifest_id UUID;
    target_version INTEGER;
    has_exact_shape BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'SubmissionManifest' THEN
        target_manifest_id := NEW."id";
    ELSE
        target_manifest_id := COALESCE(NEW."manifestId", OLD."manifestId");
    END IF;

    SELECT "version"
      INTO target_version
      FROM "SubmissionManifest"
     WHERE "id" = target_manifest_id;

    IF target_version IS NULL OR target_version <> 1 THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*) = 3
       AND COUNT(*) FILTER (WHERE "category" = 'PART_1') = 1
       AND COUNT(*) FILTER (WHERE "category" = 'PART_2') = 1
       AND COUNT(*) FILTER (WHERE "category" = 'PART_3') = 1
       AND COUNT(*) FILTER (WHERE "deliveryPosition" = 1) = 1
       AND COUNT(*) FILTER (WHERE "deliveryPosition" = 2) = 1
       AND COUNT(*) FILTER (WHERE "deliveryPosition" = 3) = 1
      INTO has_exact_shape
      FROM "ManifestEntry"
     WHERE "manifestId" = target_manifest_id;

    IF NOT has_exact_shape THEN
        RAISE EXCEPTION
          'Submission manifest version 1 must contain exactly PART_1, PART_2, PART_3 at positions 1, 2, 3'
          USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "SubmissionManifest_v1_shape_check"
AFTER INSERT OR UPDATE ON "SubmissionManifest"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_submission_manifest_v1_shape();

CREATE CONSTRAINT TRIGGER "ManifestEntry_v1_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "ManifestEntry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_submission_manifest_v1_shape();

-- Retained manifest evidence has no ordinary application mutation or deletion
-- path. A future purge must be a separately approved privileged operation.
CREATE FUNCTION reject_submission_manifest_evidence_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
      'Submission manifest evidence is immutable: % on %', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "SubmissionManifest_immutable"
BEFORE UPDATE OR DELETE ON "SubmissionManifest"
FOR EACH ROW
EXECUTE FUNCTION reject_submission_manifest_evidence_mutation();

CREATE TRIGGER "ManifestEntry_immutable"
BEFORE UPDATE OR DELETE ON "ManifestEntry"
FOR EACH ROW
EXECUTE FUNCTION reject_submission_manifest_evidence_mutation();

CREATE TRIGGER "ManifestTask_immutable"
BEFORE UPDATE OR DELETE ON "ManifestTask"
FOR EACH ROW
EXECUTE FUNCTION reject_submission_manifest_evidence_mutation();
