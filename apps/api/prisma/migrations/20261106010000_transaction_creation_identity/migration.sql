-- Hand-written: retry identity belongs to the lifetime of its posting.
-- No data reset or historical backfill. Earlier migrations remain unchanged.
BEGIN;
ALTER TABLE "Transaction"
  ADD COLUMN "clientRequestId" UUID,
  ADD COLUMN "creationFingerprint" VARCHAR(64),
  ADD CONSTRAINT "Transaction_creation_identity_pair" CHECK (
    ("clientRequestId" IS NULL) = ("creationFingerprint" IS NULL)
  ),
  ADD CONSTRAINT "Transaction_creation_fingerprint" CHECK (
    "creationFingerprint" IS NULL OR "creationFingerprint" ~ '^[0-9a-f]{64}$'
  );
-- PostgreSQL permits multiple NULL keys for internal/generated postings.
CREATE UNIQUE INDEX "Transaction_userId_clientRequestId_key"
  ON "Transaction" ("userId", "clientRequestId");

CREATE FUNCTION protect_transaction_creation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."clientRequestId" IS DISTINCT FROM OLD."clientRequestId" OR
     NEW."creationFingerprint" IS DISTINCT FROM OLD."creationFingerprint" THEN
    RAISE EXCEPTION 'Transaction creation identity is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_creation_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Transaction_creation_identity_immutable"
  BEFORE UPDATE OF "clientRequestId", "creationFingerprint" ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION protect_transaction_creation_identity();

DROP TABLE "TransactionCreation";
COMMIT;
