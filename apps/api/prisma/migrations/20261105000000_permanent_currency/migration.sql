-- Hand-written: Prisma describes nullability, while SQL enforces write-once
-- selection even when a caller bypasses the API. No data reset or backfill.
BEGIN;
DROP TRIGGER "Transaction_currency_preference" ON "Transaction";
DROP FUNCTION enforce_finance_currency();
DROP TRIGGER "FinancePreferences_currency_locked" ON "FinancePreferences";
DROP FUNCTION protect_finance_currency_lock();
ALTER TABLE "FinancePreferences"
  ALTER COLUMN "entryCurrency" DROP NOT NULL,
  ALTER COLUMN "entryCurrency" DROP DEFAULT,
  DROP COLUMN "currencyLockedAt";

CREATE FUNCTION protect_permanent_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM id FROM "User" WHERE id = OLD."userId" FOR UPDATE;
    IF OLD."entryCurrency" IS NOT NULL THEN
      RAISE EXCEPTION 'A chosen currency cannot be cleared by deleting preferences.'
        USING ERRCODE = '23514', CONSTRAINT = 'FinancePreferences_currency_immutable';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."userId" IS DISTINCT FROM OLD."userId" OR
      (OLD."entryCurrency" IS NOT NULL AND NEW."entryCurrency" IS DISTINCT FROM OLD."entryCurrency") THEN
      RAISE EXCEPTION 'A chosen currency and its owner are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'FinancePreferences_currency_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinancePreferences_currency_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "FinancePreferences"
  FOR EACH ROW EXECUTE FUNCTION protect_permanent_currency();

-- SQL's `null <> currency` evaluates to unknown, not true. Explicitly reject
-- an unset choice; otherwise a direct account insert could bypass onboarding.
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
    IF NEW."legacyCurrency" IS NOT NULL THEN RAISE EXCEPTION 'Migration identity is server-owned.'; END IF;
    SELECT "entryCurrency" INTO configured_currency FROM "FinancePreferences" WHERE "userId" = NEW."userId";
    IF NOT FOUND OR configured_currency IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'Choose a permanent currency before creating a matching account.'
        USING ERRCODE = '23514', CONSTRAINT = 'Account_currency_preference';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_default_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected "Account"%ROWTYPE;
BEGIN
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF NEW."defaultAccountId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO selected FROM "Account" WHERE id = NEW."defaultAccountId" AND "userId" = NEW."userId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Default account must belong to the preference owner.'
      USING ERRCODE = '23503', CONSTRAINT = 'FinancePreferences_default_account_owner_fkey';
  END IF;
  IF selected."archivedAt" IS NOT NULL OR selected.currency IS DISTINCT FROM NEW."entryCurrency" THEN
    RAISE EXCEPTION 'Default account must be active and match the chosen currency.'
      USING ERRCODE = '23514', CONSTRAINT = 'FinancePreferences_default_account_eligible';
  END IF;
  RETURN NEW;
END;
$$;
COMMIT;
