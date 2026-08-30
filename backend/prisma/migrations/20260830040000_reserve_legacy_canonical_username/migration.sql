-- Preserve legacy username rows while preventing a new canonical username
-- from impersonating an existing case-variant identity.
CREATE OR REPLACE FUNCTION reject_canonical_username_legacy_collision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."username" = LOWER(NEW."username")
     AND EXISTS (
       SELECT 1
       FROM "User"
       WHERE "id" <> NEW."id"
         AND LOWER("username") = NEW."username"
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'User_username_key',
      MESSAGE = 'duplicate canonical username';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_canonical_username_legacy_collision"
BEFORE INSERT OR UPDATE OF "username" ON "User"
FOR EACH ROW
EXECUTE FUNCTION reject_canonical_username_legacy_collision();
