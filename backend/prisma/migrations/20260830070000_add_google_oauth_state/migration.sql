CREATE TABLE "GoogleOAuthState" (
    "id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleOAuthState_state_key"
    ON "GoogleOAuthState"("state");

CREATE INDEX "GoogleOAuthState_expiresAt_idx"
    ON "GoogleOAuthState"("expiresAt");

ALTER TABLE "GoogleOAuthState"
    ADD CONSTRAINT "GoogleOAuthState_returnTo_check"
    CHECK ("returnTo" IN ('login', 'signup'));
