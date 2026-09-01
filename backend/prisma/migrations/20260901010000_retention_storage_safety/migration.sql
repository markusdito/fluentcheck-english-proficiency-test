-- Issue #76: close the storage-identity and database-write races around
-- Submission quarantine/finalization.

ALTER TYPE "SubmissionPurgeObjectStatus" ADD VALUE 'MISSING';
ALTER TYPE "PromptMediaCleanupRunStatus" ADD VALUE 'RUNNING';

-- A purge object is a durable reservation for the exact Answer-media
-- identity.  It prevents a later Answer from reusing an identity whose
-- storage has already been confirmed absent, while allowing ordinary legacy
-- rows that happen to share a key until a purge is actually in progress.
CREATE FUNCTION reject_answer_retention_or_storage_reuse()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_retention_status "SubmissionRetentionStatus";
BEGIN
    PERFORM lock_prompt_media_storage_identity(NEW."storageKey");

    SELECT "retentionStatus"
      INTO target_retention_status
      FROM "Submission"
     WHERE "id" = NEW."submissionId"
     FOR KEY SHARE;

    IF target_retention_status IS DISTINCT FROM 'RETAINED' THEN
        RAISE EXCEPTION
          'Answer writes are blocked for a non-retained Submission: %',
          NEW."submissionId"
          USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "SubmissionPurgeObject" purge_object
         WHERE purge_object."storageKey" = NEW."storageKey"
           AND (
             NEW."bucket" IS NULL
             OR purge_object."bucket" = NEW."bucket"
           )
           AND purge_object."status" IN (
             'QUARANTINED',
             'DELETE_PENDING',
             'FAILED',
             'DELETED',
             'MISSING'
           )
    ) THEN
        RAISE EXCEPTION
          'Answer storage identity is reserved by a purge workflow: %',
          NEW."storageKey"
          USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "Answer_retention_guard"
BEFORE INSERT OR UPDATE OF "submissionId", "storageKey", "bucket" ON "Answer"
FOR EACH ROW
EXECUTE FUNCTION reject_answer_retention_or_storage_reuse();
