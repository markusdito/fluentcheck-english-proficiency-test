ALTER TABLE "Answer"
  ADD COLUMN "verifiedAt" TIMESTAMPTZ,
  ADD COLUMN "observedMimeType" TEXT,
  ADD COLUMN "proofVersion" INTEGER;
