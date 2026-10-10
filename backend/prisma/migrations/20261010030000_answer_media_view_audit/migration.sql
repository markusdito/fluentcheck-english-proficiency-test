-- PRD FR-4.4 / issue #178: every issued Answer video URL is audited.
-- CreateEnum
CREATE TYPE "AnswerMediaViewContext" AS ENUM ('EXAMINER_ASSIGNMENT', 'ADMIN_SUBMISSION', 'ADMIN_FLAG_REVIEW');

-- CreateTable
CREATE TABLE "AnswerMediaViewEvent" (
    "id" UUID NOT NULL,
    "answerId" UUID,
    "submissionId" UUID NOT NULL,
    "viewerId" UUID,
    "viewerRole" "Role" NOT NULL,
    "context" "AnswerMediaViewContext" NOT NULL,
    "assignmentId" UUID,
    "flagId" UUID,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerMediaViewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnswerMediaViewEvent_submissionId_createdAt_idx" ON "AnswerMediaViewEvent"("submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "AnswerMediaViewEvent_answerId_createdAt_idx" ON "AnswerMediaViewEvent"("answerId", "createdAt");

-- CreateIndex
CREATE INDEX "AnswerMediaViewEvent_viewerId_createdAt_idx" ON "AnswerMediaViewEvent"("viewerId", "createdAt");

-- AddForeignKey
ALTER TABLE "AnswerMediaViewEvent" ADD CONSTRAINT "AnswerMediaViewEvent_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerMediaViewEvent" ADD CONSTRAINT "AnswerMediaViewEvent_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Audit rows are immutable. The only permitted change is the internal
-- ON DELETE SET NULL cascade (Answer purge, viewer deletion), which runs at
-- trigger depth > 1 and may only null "answerId"/"viewerId". Direct
-- UPDATE/DELETE/TRUNCATE statements remain forbidden.
CREATE FUNCTION reject_answer_media_view_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
        IF (NEW."answerId" IS NULL OR NEW."answerId" = OLD."answerId")
           AND (NEW."viewerId" IS NULL OR NEW."viewerId" = OLD."viewerId")
           AND (to_jsonb(NEW) - 'answerId' - 'viewerId')
               = (to_jsonb(OLD) - 'answerId' - 'viewerId') THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION
      'Answer media view events are immutable: %', TG_OP
      USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AnswerMediaViewEvent_immutable"
BEFORE UPDATE OR DELETE ON "AnswerMediaViewEvent"
FOR EACH ROW
EXECUTE FUNCTION reject_answer_media_view_mutation();

CREATE TRIGGER "AnswerMediaViewEvent_no_truncate"
BEFORE TRUNCATE ON "AnswerMediaViewEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_answer_media_view_mutation();
