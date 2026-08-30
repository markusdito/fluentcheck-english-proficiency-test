-- Contract phase for the account identity rollout.
-- Run the read-only account-identity preflight and obtain deployment approval
-- before applying this migration to a production database.
BEGIN;

DO $$
DECLARE
  normalized_email_conflicts INTEGER;
  canonical_username_conflicts INTEGER;
  invalid_legacy_usernames INTEGER;
  normalized_email_mismatches INTEGER;
BEGIN
  SELECT COUNT(*)::int INTO normalized_email_conflicts
    FROM (
      SELECT LOWER(BTRIM("email"))
        FROM "User"
       GROUP BY LOWER(BTRIM("email"))
      HAVING COUNT(*) > 1
    ) conflicts;

  SELECT COUNT(*)::int INTO canonical_username_conflicts
    FROM (
      SELECT LOWER(BTRIM("username"))
        FROM "User"
       GROUP BY LOWER(BTRIM("username"))
      HAVING COUNT(*) > 1
    ) conflicts;

  SELECT COUNT(*)::int INTO invalid_legacy_usernames
    FROM "User"
   WHERE CHAR_LENGTH(LOWER(BTRIM("username"))) NOT BETWEEN 1 AND 50
      OR LOWER(BTRIM("username")) !~ '^[a-z0-9_]+$';

  SELECT COUNT(*)::int INTO normalized_email_mismatches
    FROM "User"
   WHERE "normalizedEmail" IS NOT NULL
     AND "normalizedEmail" <> LOWER(BTRIM("email"));

  IF normalized_email_conflicts > 0
     OR canonical_username_conflicts > 0
     OR invalid_legacy_usernames > 0
     OR normalized_email_mismatches > 0 THEN
    RAISE EXCEPTION
      'account identity contract preflight failed: normalized_email_conflicts=%, canonical_username_conflicts=%, invalid_legacy_usernames=%, normalized_email_mismatches=%',
      normalized_email_conflicts,
      canonical_username_conflicts,
      invalid_legacy_usernames,
      normalized_email_mismatches;
  END IF;
END;
$$;

-- The compatibility triggers are no longer needed once every account has a
-- canonical identity. They are removed in the same transaction as the final
-- backfill so a failure leaves the expand-phase model intact.
DROP TRIGGER IF EXISTS "User_normalizedEmail_legacy_collision" ON "User";
DROP TRIGGER IF EXISTS "User_canonical_username_legacy_collision" ON "User";
DROP FUNCTION IF EXISTS reject_normalized_email_legacy_collision();
DROP FUNCTION IF EXISTS reject_canonical_username_legacy_collision();

UPDATE "User"
   SET "email" = BTRIM("email"),
       "username" = LOWER(BTRIM("username")),
       "normalizedEmail" = LOWER(BTRIM("email"));

ALTER TABLE "User"
  ALTER COLUMN "normalizedEmail" SET NOT NULL;

DROP INDEX IF EXISTS "User_email_key";

ALTER TABLE "User"
  ADD CONSTRAINT "User_username_canonical_check"
    CHECK (
      "username" = LOWER(BTRIM("username"))
      AND CHAR_LENGTH("username") BETWEEN 1 AND 50
      AND "username" ~ '^[a-z0-9_]+$'
    ),
  ADD CONSTRAINT "User_email_trimmed_check"
    CHECK ("email" = BTRIM("email")),
  ADD CONSTRAINT "User_normalizedEmail_canonical_check"
    CHECK ("normalizedEmail" = LOWER(BTRIM("email")));

COMMIT;
