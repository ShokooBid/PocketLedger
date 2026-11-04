-- Forward-only consolidation. Stop old API instances and finish the documented
-- one-time account backfill before applying this migration to an existing ledger.
BEGIN;
LOCK TABLE "User", "Account", "FinancePreferences", "Transaction" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Transaction" t
    LEFT JOIN "Account" a ON a.id = t."accountId" AND a."userId" = t."userId" AND a.currency = t.currency
    LEFT JOIN "FinancePreferences" p ON p."userId" = t."userId"
    WHERE a.id IS NULL OR t.date < a."openingDate" OR p."currencyLockedAt" IS NULL) THEN
    RAISE EXCEPTION 'Complete the finance account backfill before deploying the canonical API.'
      USING HINT = 'Use finance:migrate prepare --apply and backfill --apply against the expansion schema. Preserve all existing rows.';
  END IF;
END $$;
ALTER TABLE "Transaction" ALTER COLUMN "accountId" SET NOT NULL;

CREATE OR REPLACE FUNCTION enforce_account_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected "Account"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM id FROM "User" WHERE id = OLD."userId" FOR UPDATE;
    RETURN OLD;
  END IF;
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.currency <> OLD.currency OR NEW."userId" <> OLD."userId" OR NEW.id <> OLD.id OR
      NEW."importId" IS DISTINCT FROM OLD."importId" THEN
      RAISE EXCEPTION 'Recorded currency, owner, identity and provenance are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'Transaction_identity_immutable';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM "FinancePreferences"
    WHERE "userId" = NEW."userId" AND "entryCurrency" = NEW.currency) THEN
    RAISE EXCEPTION 'New postings require configured compatible currency preferences.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_currency_preference';
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
    IF NOT FOUND OR configured_currency <> NEW.currency THEN
      RAISE EXCEPTION 'Account currency must inherit Settings.'
        USING ERRCODE = '23514', CONSTRAINT = 'Account_currency_preference';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TABLE "FinanceRollout";
DROP FUNCTION protect_finance_rollout();
COMMIT;
