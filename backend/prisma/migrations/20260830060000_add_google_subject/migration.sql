-- Google's stable subject is nullable for local-only accounts and unique when present.
ALTER TABLE "User"
  ADD COLUMN "googleSubject" TEXT;

CREATE UNIQUE INDEX "User_googleSubject_key"
  ON "User"("googleSubject");
