-- Issue #76: make Submission retention and Prompt-media cleanup explicit,
-- dual-controlled, recoverable, and auditable.

CREATE TYPE "SubmissionRetentionStatus" AS ENUM ('RETAINED', 'QUARANTINED', 'PURGED');
CREATE TYPE "SubmissionPurgeRequestStatus" AS ENUM ('REQUESTED', 'QUARANTINED', 'FAILED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "SubmissionPurgeObjectKind" AS ENUM ('ANSWER_MEDIA');
CREATE TYPE "SubmissionPurgeObjectStatus" AS ENUM ('QUARANTINED', 'DELETE_PENDING', 'DELETED', 'FAILED', 'CANCELLED');
CREATE TYPE "RetentionHoldType" AS ENUM ('LEGAL', 'DISPUTE', 'PAYMENT', 'SCORING_REVIEW', 'RECOVERY', 'CERTIFICATE', 'ADMIN');
CREATE TYPE "PromptMediaCleanupRunMode" AS ENUM ('QUARANTINE', 'FINALIZE');
CREATE TYPE "PromptMediaCleanupRunStatus" AS ENUM ('COMPLETED', 'FAILED');
CREATE TYPE "PromptMediaCleanupObjectStatus" AS ENUM ('QUARANTINED', 'DELETE_PENDING', 'DELETED', 'FAILED', 'SKIPPED_REFERENCED', 'MISSING');
CREATE TYPE "RetentionAuditAction" AS ENUM (
    'PURGE_REQUESTED',
    'PURGE_APPROVED',
    'PURGE_CANCELLED',
    'PURGE_DELETE_ATTEMPTED',
    'PURGE_DELETE_CONFIRMED',
    'PURGE_DELETE_FAILED',
    'PURGE_COMPLETED',
    'PROMPT_CLEANUP_AUTHORIZED',
    'PROMPT_CLEANUP_QUARANTINED',
    'PROMPT_CLEANUP_SKIPPED',
    'PROMPT_CLEANUP_DELETE_ATTEMPTED',
    'PROMPT_CLEANUP_DELETE_CONFIRMED',
    'PROMPT_CLEANUP_DELETE_FAILED',
    'PROMPT_CLEANUP_ALREADY_ABSENT'
);

ALTER TABLE "Submission"
ADD COLUMN "retentionStatus" "SubmissionRetentionStatus" NOT NULL DEFAULT 'RETAINED';

CREATE TABLE "SubmissionRetentionHold" (
    "id" UUID NOT NULL,
    "targetSubmissionId" UUID NOT NULL,
    "submissionId" UUID,
    "type" "RetentionHoldType" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "releasedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ,

    CONSTRAINT "SubmissionRetentionHold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionPurgeRequest" (
    "id" UUID NOT NULL,
    "targetSubmissionId" UUID NOT NULL,
    "submissionId" UUID,
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "status" "SubmissionPurgeRequestStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMPTZ,
    "quarantineUntil" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionPurgeRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionPurgeObject" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "targetSubmissionId" UUID NOT NULL,
    "submissionId" UUID,
    "kind" "SubmissionPurgeObjectKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "status" "SubmissionPurgeObjectStatus" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "quarantineUntil" TIMESTAMPTZ,
    "lastError" TEXT,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionPurgeObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptMediaCleanupRun" (
    "id" UUID NOT NULL,
    "mode" "PromptMediaCleanupRunMode" NOT NULL,
    "actorId" UUID NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "status" "PromptMediaCleanupRunStatus" NOT NULL,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptMediaCleanupRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptMediaCleanupObject" (
    "id" UUID NOT NULL,
    "sourceQuestionId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "answerReferenceCount" INTEGER NOT NULL DEFAULT 0,
    "manifestReferenceCount" INTEGER NOT NULL DEFAULT 0,
    "referenceSnapshot" JSONB,
    "eligibilityReason" TEXT NOT NULL,
    "status" "PromptMediaCleanupObjectStatus" NOT NULL,
    "lastRunId" UUID NOT NULL,
    "quarantineUntil" TIMESTAMPTZ,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptMediaCleanupObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetentionAuditEvent" (
    "id" UUID NOT NULL,
    "targetSubmissionId" UUID,
    "submissionId" UUID,
    "purgeRequestId" UUID,
    "cleanupRunId" UUID,
    "actorId" UUID NOT NULL,
    "action" "RetentionAuditAction" NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "storageKey" TEXT,
    "outcome" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Submission_retentionStatus_status_idx"
ON "Submission"("retentionStatus", "status");

CREATE INDEX "SubmissionRetentionHold_submissionId_releasedAt_idx"
ON "SubmissionRetentionHold"("submissionId", "releasedAt");
CREATE INDEX "SubmissionRetentionHold_targetSubmissionId_releasedAt_idx"
ON "SubmissionRetentionHold"("targetSubmissionId", "releasedAt");

CREATE INDEX "SubmissionPurgeRequest_targetSubmissionId_status_idx"
ON "SubmissionPurgeRequest"("targetSubmissionId", "status");
CREATE INDEX "SubmissionPurgeRequest_submissionId_status_idx"
ON "SubmissionPurgeRequest"("submissionId", "status");

CREATE UNIQUE INDEX "SubmissionPurgeObject_requestId_storageKey_key"
ON "SubmissionPurgeObject"("requestId", "storageKey");
CREATE INDEX "SubmissionPurgeObject_storageKey_status_idx"
ON "SubmissionPurgeObject"("storageKey", "status");
CREATE INDEX "SubmissionPurgeObject_targetSubmissionId_status_idx"
ON "SubmissionPurgeObject"("targetSubmissionId", "status");

CREATE INDEX "PromptMediaCleanupRun_mode_status_createdAt_idx"
ON "PromptMediaCleanupRun"("mode", "status", "createdAt");

CREATE UNIQUE INDEX "PromptMediaCleanupObject_storageKey_key"
ON "PromptMediaCleanupObject"("storageKey");
CREATE INDEX "PromptMediaCleanupObject_status_quarantineUntil_idx"
ON "PromptMediaCleanupObject"("status", "quarantineUntil");
CREATE INDEX "PromptMediaCleanupObject_sourceQuestionId_status_idx"
ON "PromptMediaCleanupObject"("sourceQuestionId", "status");

CREATE INDEX "RetentionAuditEvent_targetSubmissionId_createdAt_idx"
ON "RetentionAuditEvent"("targetSubmissionId", "createdAt");
CREATE INDEX "RetentionAuditEvent_purgeRequestId_createdAt_idx"
ON "RetentionAuditEvent"("purgeRequestId", "createdAt");
CREATE INDEX "RetentionAuditEvent_cleanupRunId_createdAt_idx"
ON "RetentionAuditEvent"("cleanupRunId", "createdAt");
CREATE INDEX "RetentionAuditEvent_storageKey_createdAt_idx"
ON "RetentionAuditEvent"("storageKey", "createdAt");

ALTER TABLE "SubmissionRetentionHold"
ADD CONSTRAINT "SubmissionRetentionHold_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "SubmissionRetentionHold_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "SubmissionRetentionHold_releasedById_fkey"
FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubmissionPurgeRequest"
ADD CONSTRAINT "SubmissionPurgeRequest_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "SubmissionPurgeRequest_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "SubmissionPurgeRequest_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubmissionPurgeObject"
ADD CONSTRAINT "SubmissionPurgeObject_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "SubmissionPurgeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "SubmissionPurgeObject_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PromptMediaCleanupRun"
ADD CONSTRAINT "PromptMediaCleanupRun_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PromptMediaCleanupObject"
ADD CONSTRAINT "PromptMediaCleanupObject_sourceQuestionId_fkey"
FOREIGN KEY ("sourceQuestionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "PromptMediaCleanupObject_lastRunId_fkey"
FOREIGN KEY ("lastRunId") REFERENCES "PromptMediaCleanupRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RetentionAuditEvent"
ADD CONSTRAINT "RetentionAuditEvent_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "RetentionAuditEvent_purgeRequestId_fkey"
FOREIGN KEY ("purgeRequestId") REFERENCES "SubmissionPurgeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "RetentionAuditEvent_cleanupRunId_fkey"
FOREIGN KEY ("cleanupRunId") REFERENCES "PromptMediaCleanupRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "RetentionAuditEvent_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A lock is held for every Prompt-media storage identity touched by a
-- reference write/removal. The cleanup final check keeps the same lock while
-- it confirms storage deletion, so a concurrent reference cannot race it.
CREATE FUNCTION lock_prompt_media_storage_identity(storage_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(storage_key, 0));
END;
$$;

CREATE FUNCTION lock_prompt_media_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_key TEXT;
    new_key TEXT;
    candidate_key TEXT;
BEGIN
    IF TG_TABLE_NAME = 'ManifestEntry' THEN
        IF TG_OP <> 'INSERT' THEN
            old_key := OLD."promptMediaStorageKey";
        END IF;
        IF TG_OP <> 'DELETE' THEN
            new_key := NEW."promptMediaStorageKey";
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            IF OLD."manifestEntryId" IS NOT NULL THEN
                SELECT "promptMediaStorageKey"
                  INTO old_key
                  FROM "ManifestEntry"
                 WHERE "id" = OLD."manifestEntryId"
                   AND "submissionId" = OLD."submissionId";
            END IF;
            IF old_key IS NULL AND OLD."questionId" IS NOT NULL THEN
                SELECT "audioStorageKey"
                  INTO old_key
                  FROM "Question"
                 WHERE "id" = OLD."questionId";
            END IF;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            IF NEW."manifestEntryId" IS NOT NULL THEN
                SELECT "promptMediaStorageKey"
                  INTO new_key
                  FROM "ManifestEntry"
                 WHERE "id" = NEW."manifestEntryId"
                   AND "submissionId" = NEW."submissionId";
            END IF;
            IF new_key IS NULL AND NEW."questionId" IS NOT NULL THEN
                SELECT "audioStorageKey"
                  INTO new_key
                  FROM "Question"
                 WHERE "id" = NEW."questionId";
            END IF;
        END IF;
    END IF;

    FOR candidate_key IN
        SELECT DISTINCT value
          FROM (VALUES (old_key), (new_key)) AS keys(value)
         WHERE value IS NOT NULL AND value <> ''
         ORDER BY value
    LOOP
        PERFORM lock_prompt_media_storage_identity(candidate_key);
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "ManifestEntry_prompt_media_reference_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "ManifestEntry"
FOR EACH ROW
EXECUTE FUNCTION lock_prompt_media_reference();

CREATE TRIGGER "Answer_prompt_media_reference_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "Answer"
FOR EACH ROW
EXECUTE FUNCTION lock_prompt_media_reference();

-- The existing manifest shape and immutability triggers remain in force for
-- ordinary traffic. A purge transaction may bypass them only when it has set
-- a transaction-local request id whose request is still QUARANTINED.
CREATE FUNCTION retention_purge_is_authorized(target_submission_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT target_submission_id IS NOT NULL
       AND current_setting('fluentcheck.retention_purge_request_id', true) IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM "SubmissionPurgeRequest"
          WHERE "id" = current_setting('fluentcheck.retention_purge_request_id', true)::uuid
            AND "targetSubmissionId" = target_submission_id
            AND "status" = 'QUARANTINED'
       );
$$;

CREATE OR REPLACE FUNCTION enforce_submission_manifest_v1_shape()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_manifest_id UUID;
    target_submission_id UUID;
    target_version INTEGER;
    has_exact_shape BOOLEAN;
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

    IF target_version IS NULL OR target_version <> 1 THEN
        RETURN NULL;
    END IF;

    has_exact_shape := submission_manifest_v1_has_exact_shape(target_manifest_id);

    IF NOT has_exact_shape THEN
        RAISE EXCEPTION
          'Submission manifest version 1 must contain exactly PART_1, PART_2, PART_3 at positions 1, 2, 3'
          USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION reject_submission_manifest_evidence_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_submission_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'SubmissionManifest' THEN
        target_submission_id := COALESCE(NEW."submissionId", OLD."submissionId");
    ELSIF TG_TABLE_NAME = 'ManifestEntry' THEN
        target_submission_id := COALESCE(NEW."submissionId", OLD."submissionId");
    ELSE
        SELECT "submissionId"
          INTO target_submission_id
          FROM "ManifestEntry"
         WHERE "id" = COALESCE(NEW."manifestEntryId", OLD."manifestEntryId")
           AND "sourceQuestionId" = COALESCE(NEW."sourceQuestionId", OLD."sourceQuestionId");
    END IF;

    IF TG_OP = 'DELETE' AND retention_purge_is_authorized(target_submission_id) THEN
        IF TG_TABLE_NAME = 'ManifestTask' THEN
            RETURN OLD;
        END IF;
        RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'Submission manifest evidence is immutable: % on %', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION reject_retention_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
      'Retention audit events are immutable: %', TG_OP
      USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "RetentionAuditEvent_immutable"
BEFORE UPDATE OR DELETE ON "RetentionAuditEvent"
FOR EACH ROW
EXECUTE FUNCTION reject_retention_audit_mutation();
