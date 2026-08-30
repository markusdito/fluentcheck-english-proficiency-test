-- Keep legacy display-email identities reserved while normalizedEmail is still
-- NULL. Existing expand-phase collisions remain readable; only a new or
-- backfilled normalized write is rejected by this database boundary.
CREATE OR REPLACE FUNCTION reject_normalized_email_legacy_collision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."normalizedEmail" IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM "User"
       WHERE "id" <> NEW."id"
         AND "normalizedEmail" IS NULL
         AND LOWER(BTRIM("email")) = NEW."normalizedEmail"
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'User_normalizedEmail_key',
      MESSAGE = 'duplicate normalized email identity';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_normalizedEmail_legacy_collision"
BEFORE INSERT OR UPDATE OF "normalizedEmail", "email" ON "User"
FOR EACH ROW
EXECUTE FUNCTION reject_normalized_email_legacy_collision();
