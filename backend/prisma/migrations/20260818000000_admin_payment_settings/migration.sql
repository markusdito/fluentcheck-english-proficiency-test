-- AlterTable
ALTER TABLE "Submission"
ADD COLUMN "paymentRequired" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "paymentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AppSettings_singleton_check" CHECK ("id" = 1)
);

-- Seed the singleton with the current payment-required behavior.
INSERT INTO "AppSettings" ("id", "paymentEnabled")
VALUES (1, true);
