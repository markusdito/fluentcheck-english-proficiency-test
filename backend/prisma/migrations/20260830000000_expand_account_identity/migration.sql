-- Expand the account identity model without changing existing display emails
-- or applying the final non-null/unique contract. Later migration phases own
-- conflict preflight, backfill, and the final identity constraints.
ALTER TABLE "User"
ADD COLUMN "normalizedEmail" TEXT;
