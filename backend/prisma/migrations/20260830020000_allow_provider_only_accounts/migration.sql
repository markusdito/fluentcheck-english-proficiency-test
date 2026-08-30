-- Provider-only accounts have no local password and must still be handled by
-- the same dummy-hash login comparison path as unknown identities.
ALTER TABLE "User"
ALTER COLUMN "password" DROP NOT NULL;
