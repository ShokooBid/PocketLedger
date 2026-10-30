-- Additive and dormant until a user activates the gated preferences flow.
-- Existing data is untouched; no preferences are activated by this migration.
CREATE TABLE "FinancePreferences" (
  "userId" UUID NOT NULL PRIMARY KEY,
  "entryCurrency" VARCHAR(3) NOT NULL DEFAULT 'CAD',
  "currencyLockedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePreferences_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FinancePreferences_currency" CHECK (
    "entryCurrency" IN ('CAD', 'USD', 'EUR', 'GBP', 'INR', 'JPY', 'KWD')
  )
);

CREATE FUNCTION enforce_finance_currency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE preference "FinancePreferences"%ROWTYPE;
BEGIN
  -- Activation, preference changes and every posting use the same owner lock.
  -- Even a legacy insert with no preference serializes with activation.
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  SELECT * INTO preference FROM "FinancePreferences" WHERE "userId" = NEW."userId";
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.currency <> OLD.currency OR NEW."userId" <> OLD."userId" THEN
      RAISE EXCEPTION 'Recorded currency and owner cannot be changed.'
        USING ERRCODE = '23514', CONSTRAINT = 'Transaction_currency_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.currency <> preference."entryCurrency" THEN
    RAISE EXCEPTION 'Posting currency must match the configured currency.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_currency_preference';
  END IF;
  UPDATE "FinancePreferences"
    SET "currencyLockedAt" = COALESCE("currencyLockedAt", CURRENT_TIMESTAMP),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = NEW."userId";
  -- If a later constraint fails, both the posting and this lock roll back.
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Transaction_currency_preference"
BEFORE INSERT OR UPDATE OF currency, "userId" ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION enforce_finance_currency();

CREATE FUNCTION protect_finance_currency_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."currencyLockedAt" IS NOT NULL AND (
    NEW."entryCurrency" <> OLD."entryCurrency" OR
    NEW."currencyLockedAt" IS DISTINCT FROM OLD."currencyLockedAt"
  ) THEN
    RAISE EXCEPTION 'Currency is locked after the first transaction.'
      USING ERRCODE = '23514', CONSTRAINT = 'FinancePreferences_currency_locked';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinancePreferences_currency_locked"
BEFORE UPDATE ON "FinancePreferences"
FOR EACH ROW EXECUTE FUNCTION protect_finance_currency_lock();
