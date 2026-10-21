-- Hand-written additive migration. Never rewrite the two applied migrations.
ALTER TABLE "Session" ADD COLUMN "reauthenticatedAt" TIMESTAMPTZ(3);

CREATE TABLE "AuthChallenge" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nonceHash" VARCHAR(64) NOT NULL,
  "purpose" VARCHAR(20) NOT NULL,
  "sessionId" UUID,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthChallenge_nonceHash_check" CHECK ("nonceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AuthChallenge_purpose_check" CHECK (
    ("purpose" = 'login' AND "sessionId" IS NULL) OR
    ("purpose" IN ('link', 'reauthenticate') AND "sessionId" IS NOT NULL)
  ),
  CONSTRAINT "AuthChallenge_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "AuthChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "AuthChallenge_nonceHash_key" ON "AuthChallenge"("nonceHash");
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");
CREATE INDEX "AuthChallenge_sessionId_idx" ON "AuthChallenge"("sessionId");

-- Preserve contact values, while closing normalization races (including legacy
-- mixed-case/space-padded emails). Existing collisions fail deployment for review;
-- this migration never merges accounts or deletes data.
CREATE UNIQUE INDEX "User_normalized_email_key" ON "User" (lower(btrim("email")));
