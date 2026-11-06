-- Hand-written: replace posting guards before removing their duplicated fields.
-- Earlier migrations remain immutable history; no data reset or backfill here.
BEGIN;
LOCK TABLE "User", "Account", "FinancePreferences", "Transaction" IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION enforce_account_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configured_currency text;
BEGIN
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."userId" IS DISTINCT FROM OLD."userId" OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
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
    SELECT "entryCurrency" INTO configured_currency FROM "FinancePreferences" WHERE "userId" = NEW."userId";
    IF NOT FOUND OR configured_currency IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'Choose a permanent currency before creating a matching account.'
        USING ERRCODE = '23514', CONSTRAINT = 'Account_currency_preference';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_account_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected "Account"%ROWTYPE; previous_currency text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM id FROM "User" WHERE id = OLD."userId" FOR UPDATE;
    RETURN OLD;
  END IF;
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW.id IS DISTINCT FROM OLD.id OR
       NEW."importId" IS DISTINCT FROM OLD."importId" THEN
      RAISE EXCEPTION 'Owner, identity and provenance are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'Transaction_identity_immutable';
    END IF;
  END IF;
  SELECT * INTO selected FROM "Account" WHERE id = NEW."accountId" AND "userId" = NEW."userId" FOR SHARE;
  IF NOT FOUND OR NEW.date < selected."openingDate" THEN
    RAISE EXCEPTION 'Posting account ownership or opening date is invalid.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_account_eligible';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT currency INTO previous_currency FROM "Account" WHERE id = OLD."accountId" AND "userId" = OLD."userId";
    IF selected.currency IS DISTINCT FROM previous_currency THEN
      RAISE EXCEPTION 'Reassignment cannot change the denomination of an amount.'
        USING ERRCODE = '23514', CONSTRAINT = 'Transaction_account_currency_immutable';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM "FinancePreferences"
    WHERE "userId" = NEW."userId" AND "entryCurrency" = selected.currency) THEN
    RAISE EXCEPTION 'New postings require an account in the permanent currency.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_currency_preference';
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

ALTER TABLE "Transaction"
  DROP CONSTRAINT "Transaction_account_owner_currency_fkey",
  ADD CONSTRAINT "Transaction_account_owner_fkey"
    FOREIGN KEY ("accountId", "userId") REFERENCES "Account" (id, "userId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP COLUMN currency;
DROP INDEX "Account_id_userId_currency_key";
DROP INDEX "Account_userId_legacyCurrency_key";
ALTER TABLE "Account" DROP CONSTRAINT "Account_legacy_baseline", DROP COLUMN "legacyCurrency";
COMMIT;
