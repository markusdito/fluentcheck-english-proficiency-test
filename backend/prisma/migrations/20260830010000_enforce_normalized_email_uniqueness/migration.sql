-- Enforce one normalized identity for all new and backfilled accounts while
-- retaining support for legacy rows whose normalized key is still NULL.
-- Refuse ambiguous expand-phase data before changing the database contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "normalizedEmail" IS NOT NULL
    GROUP BY "normalizedEmail"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'normalized email identity conflicts require preflight remediation before the unique contract';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");
