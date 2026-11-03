-- Additive preview foundation. No accounts, defaults or postings are provisioned.
BEGIN;
CREATE TYPE "AccountType" AS ENUM ('cash', 'bank', 'credit', 'other');
CREATE TABLE "Account" (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "userId" UUID NOT NULL,
  name VARCHAR(100) NOT NULL,
  type "AccountType" NOT NULL,
  currency VARCHAR(3) NOT NULL,
  "openingBalanceMinor" INTEGER NOT NULL DEFAULT 0,
  "openingDate" DATE NOT NULL,
  "archivedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "Account_currency" CHECK (currency IN ('CAD', 'USD', 'EUR', 'GBP', 'INR', 'JPY', 'KWD')),
  CONSTRAINT "Account_opening_balance" CHECK ("openingBalanceMinor" BETWEEN -2147483647 AND 2147483647),
  CONSTRAINT "Account_opening_date" CHECK ("openingDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  CONSTRAINT "Account_name_visible" CHECK (name ~ '[^[:space:]]' AND name !~ '[[:cntrl:]]')
);
CREATE UNIQUE INDEX "Account_id_userId_key" ON "Account"(id, "userId");
CREATE INDEX "Account_userId_archivedAt_id_idx" ON "Account"("userId", "archivedAt", id);
CREATE UNIQUE INDEX "Account_active_name_key" ON "Account" (
  "userId", (translate(btrim(regexp_replace(name, E'[ \t\n\r\f' || chr(11) || ']+', ' ', 'g')),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
) WHERE "archivedAt" IS NULL;

ALTER TABLE "FinancePreferences" ADD COLUMN "defaultAccountId" UUID,
  ADD CONSTRAINT "FinancePreferences_default_account_owner_fkey"
    FOREIGN KEY ("defaultAccountId", "userId") REFERENCES "Account"(id, "userId")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION enforce_account_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configured_currency text;
BEGIN
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    -- No baseline correction/relabel flow exists, even for an unused account.
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
    IF NOT FOUND OR configured_currency <> NEW.currency THEN
      RAISE EXCEPTION 'Account currency must inherit Settings.'
        USING ERRCODE = '23514', CONSTRAINT = 'Account_currency_preference';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Account_rules" BEFORE INSERT OR UPDATE ON "Account"
  FOR EACH ROW EXECUTE FUNCTION enforce_account_rules();

CREATE FUNCTION enforce_default_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected "Account"%ROWTYPE;
BEGIN
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF NEW."defaultAccountId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO selected FROM "Account" WHERE id = NEW."defaultAccountId" AND "userId" = NEW."userId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Default account must belong to the preference owner.'
      USING ERRCODE = '23503', CONSTRAINT = 'FinancePreferences_default_account_owner_fkey';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."entryCurrency" <> OLD."entryCurrency" AND
      NEW."defaultAccountId" = OLD."defaultAccountId" AND selected.currency <> NEW."entryCurrency" THEN
      NEW."defaultAccountId" := NULL;
      RETURN NEW;
    END IF;
  END IF;
  IF selected."archivedAt" IS NOT NULL OR selected.currency <> NEW."entryCurrency" THEN
    RAISE EXCEPTION 'Default account must be active and match Settings currency.'
      USING ERRCODE = '23514', CONSTRAINT = 'FinancePreferences_default_account_eligible';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinancePreferences_default_account" BEFORE INSERT OR UPDATE ON "FinancePreferences"
  FOR EACH ROW EXECUTE FUNCTION enforce_default_account();

CREATE FUNCTION clear_archived_default_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."archivedAt" IS NULL AND NEW."archivedAt" IS NOT NULL THEN
    UPDATE "FinancePreferences" SET "defaultAccountId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = NEW."userId" AND "defaultAccountId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Account_archive_default" AFTER UPDATE OF "archivedAt" ON "Account"
  FOR EACH ROW EXECUTE FUNCTION clear_archived_default_account();
COMMIT;
