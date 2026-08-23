-- Preserve the historically overloaded provider reference as opaque legacy data.
ALTER TABLE "Payment" RENAME COLUMN "providerRef" TO "legacyProviderRef";

-- New Payment attempts keep merchant and provider identifiers in distinct fields.
ALTER TABLE "Payment"
ADD COLUMN "merchantReference" TEXT,
ADD COLUMN "providerSessionId" TEXT,
ADD COLUMN "providerTransactionId" TEXT;

CREATE UNIQUE INDEX "Payment_merchantReference_key"
ON "Payment"("merchantReference");

CREATE UNIQUE INDEX "Payment_provider_providerSessionId_key"
ON "Payment"("provider", "providerSessionId");

CREATE UNIQUE INDEX "Payment_provider_providerTransactionId_key"
ON "Payment"("provider", "providerTransactionId");
