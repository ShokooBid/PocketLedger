-- EXPAND only. No backfill, activation, runtime migration or destructive cleanup.
BEGIN;
CREATE TABLE "FinanceRollout" (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  phase VARCHAR(10) NOT NULL DEFAULT 'legacy' CHECK (phase IN ('legacy', 'upgrading', 'v2'))
);
INSERT INTO "FinanceRollout" (id) VALUES (1);
ALTER TABLE "Account" ADD COLUMN "legacyCurrency" VARCHAR(3),
  ADD CONSTRAINT "Account_legacy_baseline" CHECK ("legacyCurrency" IS NULL OR
    ("legacyCurrency" = currency AND "openingBalanceMinor" = 0));
CREATE UNIQUE INDEX "Account_id_userId_currency_key" ON "Account" (id, "userId", currency);
CREATE UNIQUE INDEX "Account_userId_legacyCurrency_key" ON "Account" ("userId", "legacyCurrency");
ALTER TABLE "Transaction" ADD COLUMN "accountId" UUID,
  ALTER COLUMN merchant DROP NOT NULL,
  ADD CONSTRAINT "Transaction_account_owner_currency_fkey"
    FOREIGN KEY ("accountId", "userId", currency) REFERENCES "Account" (id, "userId", currency)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "Transaction_userId_accountId_date_id_idx" ON "Transaction" ("userId", "accountId", date DESC, id DESC);
CREATE TABLE "TransactionCreation" (
  "userId" UUID NOT NULL REFERENCES "User" (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "clientRequestId" UUID NOT NULL,
  fingerprint VARCHAR(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "resourceId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "clientRequestId")
);

CREATE FUNCTION protect_finance_rollout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Finance rollout cannot be deleted.'; END IF;
  IF NEW.id <> OLD.id OR NOT (NEW.phase = OLD.phase OR
    (OLD.phase = 'legacy' AND NEW.phase = 'upgrading') OR
    (OLD.phase = 'upgrading' AND NEW.phase = 'v2')) THEN
    RAISE EXCEPTION 'Finance rollout only advances.';
  END IF;
  IF NEW.phase = 'v2' AND OLD.phase <> 'v2' THEN
    IF EXISTS (SELECT 1 FROM "Transaction" t LEFT JOIN "FinancePreferences" p ON p."userId" = t."userId"
      WHERE t."accountId" IS NULL OR p."currencyLockedAt" IS NULL) OR NOT EXISTS (
        SELECT 1 FROM pg_attribute WHERE attrelid = '"Transaction"'::regclass
          AND attname = 'accountId' AND attnotnull
      ) THEN
      RAISE EXCEPTION 'Verify the backfill and enforce account linkage before enabling v2.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinanceRollout_forward_only" BEFORE UPDATE OR DELETE ON "FinanceRollout"
  FOR EACH ROW EXECUTE FUNCTION protect_finance_rollout();

-- Copy #68's baseline rules, adding only the explicit legacy-assignment exception.
CREATE OR REPLACE FUNCTION enforce_account_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configured_currency text;
BEGIN
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."userId" IS DISTINCT FROM OLD."userId" OR
       NEW.currency IS DISTINCT FROM OLD.currency OR NEW."legacyCurrency" IS DISTINCT FROM OLD."legacyCurrency" OR
       NEW."openingDate" IS DISTINCT FROM OLD."openingDate" OR
       NEW."openingBalanceMinor" IS DISTINCT FROM OLD."openingBalanceMinor" THEN
      RAISE EXCEPTION 'Account ownership, currency and opening information are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'Account_baseline_immutable';
    END IF;
    IF OLD."archivedAt" IS NOT NULL AND (NEW.name IS DISTINCT FROM OLD.name OR
      NEW.type IS DISTINCT FROM OLD.type OR NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt") THEN
      RAISE EXCEPTION 'Archived accounts cannot be changed or restored.'
        USING ERRCODE = '23514', CONSTRAINT = 'Account_archived_immutable';
    END IF;
  ELSE
    IF NEW."legacyCurrency" IS NOT NULL THEN
      IF (SELECT phase FROM "FinanceRollout" WHERE id = 1) <> 'upgrading' THEN
        RAISE EXCEPTION 'Legacy accounts are created only during the gated backfill.';
      END IF;
    ELSE
      SELECT "entryCurrency" INTO configured_currency FROM "FinancePreferences" WHERE "userId" = NEW."userId";
      IF NOT FOUND OR configured_currency <> NEW.currency THEN
        RAISE EXCEPTION 'Account currency must inherit Settings.'
          USING ERRCODE = '23514', CONSTRAINT = 'Account_currency_preference';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_account_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rollout text; selected "Account"%ROWTYPE;
BEGIN
  -- Shared gate lock FIRST, then owner lock: finalization drains legacy writes.
  SELECT phase INTO rollout FROM "FinanceRollout" WHERE id = 1 FOR SHARE;
  IF TG_OP = 'DELETE' THEN
    IF rollout = 'upgrading' THEN RAISE EXCEPTION 'Finance upgrade in progress.'; END IF;
    PERFORM id FROM "User" WHERE id = OLD."userId" FOR UPDATE;
    RETURN OLD;
  END IF;
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF rollout = 'legacy' THEN
    IF NEW.merchant IS NULL OR NEW."accountId" IS NOT NULL THEN
      RAISE EXCEPTION 'Account-aware writes require the finance upgrade gate.';
    END IF;
    RETURN NEW;
  END IF;
  IF rollout = 'upgrading' THEN
    IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Finance upgrade in progress.'; END IF;
    IF OLD."accountId" IS NOT NULL OR NEW."accountId" IS NULL OR
      (to_jsonb(NEW) - 'accountId') IS DISTINCT FROM (to_jsonb(OLD) - 'accountId') THEN
      RAISE EXCEPTION 'Only additive account assignment is allowed during backfill.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.currency <> OLD.currency OR NEW."userId" <> OLD."userId" OR NEW.id <> OLD.id OR
       NEW."importId" IS DISTINCT FROM OLD."importId" THEN
      RAISE EXCEPTION 'Recorded currency, owner, identity and provenance are immutable.';
    END IF;
  END IF;
  IF NEW."accountId" IS NULL THEN RAISE EXCEPTION 'A posting requires an account.'; END IF;
  IF rollout = 'v2' AND TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM "FinancePreferences" WHERE "userId" = NEW."userId" AND "entryCurrency" = NEW.currency
  ) THEN
    RAISE EXCEPTION 'New postings require configured compatible currency preferences.';
  END IF;
  SELECT * INTO selected FROM "Account" WHERE id = NEW."accountId" AND "userId" = NEW."userId" FOR SHARE;
  IF NOT FOUND OR selected.currency <> NEW.currency OR NEW.date < selected."openingDate" THEN
    RAISE EXCEPTION 'Posting account ownership, currency or opening date is invalid.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_account_eligible';
  END IF;
  IF selected."archivedAt" IS NOT NULL THEN
    IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'New postings require an active account.'; END IF;
    IF NEW."accountId" IS DISTINCT FROM OLD."accountId" THEN
      RAISE EXCEPTION 'New assignments require an active account.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- Alphabetically before existing category/currency guards, preserving lock order.
CREATE TRIGGER "Transaction_account_posting" BEFORE INSERT OR UPDATE OR DELETE ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION enforce_account_posting();
COMMIT;
