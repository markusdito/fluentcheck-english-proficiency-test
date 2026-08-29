-- Add immutable Delivered prompt snapshot fields after the additive manifest
-- boundary. Defaults preserve compatibility for preexisting rows; new writers
-- must populate these fields from the selected source evidence.
ALTER TABLE "ManifestEntry"
  ADD COLUMN "preparationSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recordingSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "promptMediaStorageKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "promptMediaMimeType" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "promptMediaSizeBytes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ManifestTask"
  ADD COLUMN "deliveredText" TEXT NOT NULL DEFAULT '';
