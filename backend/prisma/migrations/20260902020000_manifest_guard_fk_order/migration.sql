-- Issue #76: keep ManifestTask lineage and preflight diagnostics ahead of the
-- Prompt-media reservation check for intentionally broken lineage rows.

CREATE OR REPLACE FUNCTION reject_non_retained_manifest_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_submission_id UUID;
    target_retention_status "SubmissionRetentionStatus";
    prompt_media_storage_key TEXT;
BEGIN
    IF TG_TABLE_NAME = 'SubmissionManifest' THEN
        target_submission_id := NEW."submissionId";
    ELSIF TG_TABLE_NAME = 'ManifestEntry' THEN
        target_submission_id := NEW."submissionId";
        prompt_media_storage_key := NULLIF(NEW."promptMediaStorageKey", '');
    ELSE
        SELECT "submissionId",
               CASE
                 WHEN "sourceQuestionId" = NEW."sourceQuestionId"
                 THEN NULLIF("promptMediaStorageKey", '')
                 ELSE NULL
               END
          INTO target_submission_id, prompt_media_storage_key
          FROM "ManifestEntry"
         WHERE "id" = NEW."manifestEntryId";
    END IF;

    SELECT "retentionStatus"
      INTO target_retention_status
      FROM "Submission"
     WHERE "id" = target_submission_id
     FOR KEY SHARE;

    IF target_retention_status IS DISTINCT FROM 'RETAINED' THEN
        RAISE EXCEPTION
          'Manifest evidence writes are blocked for a non-retained Submission: %',
          target_submission_id
          USING ERRCODE = '55000';
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
        )
        AND NOT EXISTS (
            SELECT 1
              FROM "Question" active_question
             WHERE active_question."audioStorageKey" = prompt_media_storage_key
               AND active_question."deletedAt" IS NULL
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
