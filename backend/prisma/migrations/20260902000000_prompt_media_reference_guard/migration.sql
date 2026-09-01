-- Issue #76: a Prompt-media cleanup reservation must also block a new Answer
-- from becoming a reference after cleanup has acquired the identity lock.

CREATE OR REPLACE FUNCTION reject_answer_retention_or_storage_reuse()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_retention_status "SubmissionRetentionStatus";
    prompt_media_storage_key TEXT;
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

    IF NEW."manifestEntryId" IS NOT NULL THEN
        SELECT NULLIF("promptMediaStorageKey", '')
          INTO prompt_media_storage_key
          FROM "ManifestEntry"
         WHERE "id" = NEW."manifestEntryId"
           AND "submissionId" = NEW."submissionId";
    END IF;
    IF prompt_media_storage_key IS NULL AND NEW."questionId" IS NOT NULL THEN
        SELECT "audioStorageKey"
          INTO prompt_media_storage_key
          FROM "Question"
         WHERE "id" = NEW."questionId";
    END IF;

    IF prompt_media_storage_key IS NOT NULL THEN
        PERFORM lock_prompt_media_storage_identity(prompt_media_storage_key);
        IF EXISTS (
            SELECT 1
              FROM "PromptMediaCleanupObject" cleanup_object
             WHERE cleanup_object."storageKey" = prompt_media_storage_key
               AND cleanup_object."status" IN (
                 'QUARANTINED',
                 'DELETE_PENDING',
                 'DELETED',
                 'FAILED',
                 'MISSING'
               )
        ) THEN
            RAISE EXCEPTION
              'Prompt-media storage identity is reserved by cleanup: %',
              prompt_media_storage_key
              USING ERRCODE = '55000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
