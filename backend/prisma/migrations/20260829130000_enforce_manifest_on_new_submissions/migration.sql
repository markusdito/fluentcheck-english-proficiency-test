-- Cutover boundary: every Submission inserted after this migration must be
-- accompanied by a complete, supported manifest in the same transaction.
-- Existing rows are intentionally untouched and remain Legacy rows.

CREATE FUNCTION enforce_manifest_on_new_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    manifest_version INTEGER;
BEGIN
    SELECT "version"
      INTO manifest_version
      FROM "SubmissionManifest"
     WHERE "submissionId" = NEW."id";

    IF manifest_version IS DISTINCT FROM 1
       OR NOT submission_manifest_v1_has_exact_shape(
         (SELECT "id" FROM "SubmissionManifest" WHERE "submissionId" = NEW."id")
       ) THEN
        RAISE EXCEPTION
          'New Submission must have a complete version-1 manifest'
          USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Submission_manifest_required_on_insert"
AFTER INSERT ON "Submission"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_manifest_on_new_submission();
