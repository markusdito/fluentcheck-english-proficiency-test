-- Issue #76: prevent direct database writes from adding manifest evidence to
-- a quarantined Submission after its normal service paths are closed.

CREATE FUNCTION reject_non_retained_manifest_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_submission_id UUID;
    target_retention_status "SubmissionRetentionStatus";
BEGIN
    IF TG_TABLE_NAME = 'SubmissionManifest' THEN
        target_submission_id := NEW."submissionId";
    ELSIF TG_TABLE_NAME = 'ManifestEntry' THEN
        target_submission_id := NEW."submissionId";
    ELSE
        SELECT "submissionId"
          INTO target_submission_id
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

    RETURN NEW;
END;
$$;

CREATE TRIGGER "SubmissionManifest_retention_guard"
BEFORE INSERT ON "SubmissionManifest"
FOR EACH ROW
EXECUTE FUNCTION reject_non_retained_manifest_evidence();

CREATE TRIGGER "ManifestEntry_retention_guard"
BEFORE INSERT ON "ManifestEntry"
FOR EACH ROW
EXECUTE FUNCTION reject_non_retained_manifest_evidence();

CREATE TRIGGER "ManifestTask_retention_guard"
BEFORE INSERT ON "ManifestTask"
FOR EACH ROW
EXECUTE FUNCTION reject_non_retained_manifest_evidence();
