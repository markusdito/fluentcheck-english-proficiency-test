-- PRD FR-2.7/FR-2.8: the server tracks each Submission's last client
-- heartbeat and abandons IN_PROGRESS Submissions whose heartbeat stops beyond
-- the grace period. Existing rows stay null; the sweeper falls back to
-- "createdAt" for them.
-- AlterTable
ALTER TABLE "Submission" ADD COLUMN "lastHeartbeatAt" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "Submission_status_lastHeartbeatAt_idx" ON "Submission"("status", "lastHeartbeatAt");
