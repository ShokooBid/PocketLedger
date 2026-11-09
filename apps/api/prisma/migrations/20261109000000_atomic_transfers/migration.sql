-- Hand-written, additive migration. Does not reset, backfill or delete a ledger.
-- Review/apply explicitly; this file is not executed during implementation.
BEGIN;
CREATE TABLE "Transfer" (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "User" (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "fromAccountId" UUID NOT NULL,
  "toAccountId" UUID NOT NULL,
  "amountMinor" INTEGER NOT NULL CHECK ("amountMinor" > 0),
  date DATE NOT NULL CHECK (date >= DATE '0001-01-01'),
  note VARCHAR(2000),
  "clientRequestId" UUID NOT NULL,
  "creationFingerprint" VARCHAR(64) NOT NULL CHECK ("creationFingerprint" ~ '^[0-9a-f]{64}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Transfer_distinct_accounts" CHECK ("fromAccountId" <> "toAccountId"),
  CONSTRAINT "Transfer_fromAccountId_userId_fkey" FOREIGN KEY ("fromAccountId", "userId")
    REFERENCES "Account" (id, "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "Transfer_toAccountId_userId_fkey" FOREIGN KEY ("toAccountId", "userId")
    REFERENCES "Account" (id, "userId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "Transfer_id_userId_key" ON "Transfer" (id, "userId");
CREATE UNIQUE INDEX "Transfer_userId_clientRequestId_key" ON "Transfer" ("userId", "clientRequestId");
CREATE INDEX "Transfer_userId_date_id_idx" ON "Transfer" ("userId", date DESC, id DESC);

ALTER TABLE "Transaction" ALTER COLUMN "categoryId" DROP NOT NULL,
  ADD COLUMN "transferId" UUID,
  ADD CONSTRAINT "Transaction_transfer_owner_fkey" FOREIGN KEY ("transferId", "userId")
    REFERENCES "Transfer" (id, "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Transaction_transfer_shape" CHECK (
    ("transferId" IS NULL AND "categoryId" IS NOT NULL) OR
    ("transferId" IS NOT NULL AND "categoryId" IS NULL AND "importId" IS NULL
      AND merchant IS NULL AND "clientRequestId" IS NULL AND "creationFingerprint" IS NULL)
  );
-- One income and one expense per transfer; ordinary NULL rows remain unrestricted.
CREATE UNIQUE INDEX "Transaction_transferId_direction_key" ON "Transaction" ("transferId", direction);

CREATE FUNCTION enforce_transfer_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "Account"%ROWTYPE; destination "Account"%ROWTYPE; previous_currency text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM id FROM "User" WHERE id = OLD."userId" FOR UPDATE;
    RETURN OLD;
  END IF;
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."userId" IS DISTINCT FROM OLD."userId" OR
      NEW."clientRequestId" IS DISTINCT FROM OLD."clientRequestId" OR
      NEW."creationFingerprint" IS DISTINCT FROM OLD."creationFingerprint" THEN
      RAISE EXCEPTION 'Transfer identity and ownership are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'Transfer_identity_immutable';
    END IF;
    SELECT currency INTO previous_currency FROM "Account" WHERE id = OLD."fromAccountId";
  END IF;
  -- The owner lock agrees with account writes; ordered reads also avoid account
  -- lock inversions. Existing transfers may be read/deleted after archival.
  PERFORM id FROM "Account" WHERE "userId" = NEW."userId" AND
    id IN (NEW."fromAccountId", NEW."toAccountId") ORDER BY id FOR SHARE;
  SELECT * INTO source FROM "Account" WHERE id = NEW."fromAccountId" AND "userId" = NEW."userId";
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer source is not owned.' USING ERRCODE = '23503'; END IF;
  SELECT * INTO destination FROM "Account" WHERE id = NEW."toAccountId" AND "userId" = NEW."userId";
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer destination is not owned.' USING ERRCODE = '23503'; END IF;
  IF source.id = destination.id OR source.currency <> destination.currency OR
    source."archivedAt" IS NOT NULL OR destination."archivedAt" IS NOT NULL OR
    NEW.date < source."openingDate" OR NEW.date < destination."openingDate" OR
    (TG_OP = 'UPDATE' AND source.currency IS DISTINCT FROM previous_currency) OR
    NOT EXISTS (SELECT 1 FROM "FinancePreferences" WHERE "userId" = NEW."userId"
      AND "entryCurrency" = source.currency) THEN
    RAISE EXCEPTION 'Transfer requires distinct active compatible accounts and valid dates.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transfer_accounts_eligible';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Transfer_rules" BEFORE INSERT OR UPDATE OR DELETE ON "Transfer"
  FOR EACH ROW EXECUTE FUNCTION enforce_transfer_rules();

CREATE FUNCTION protect_transfer_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."transferId" IS DISTINCT FROM OLD."transferId" THEN
    RAISE EXCEPTION 'Postings cannot be attached to or detached from a transfer.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_transfer_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Transaction_transfer_immutable" BEFORE UPDATE OF "transferId" ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION protect_transfer_membership();

-- Preserve existing shared/private category rules, bypassing only category-free
-- transfer legs. The shape CHECK rejects null categories on normal transactions.
CREATE OR REPLACE FUNCTION check_transaction_category_active() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected "Category"%ROWTYPE;
BEGIN
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF NEW."transferId" IS NOT NULL AND NEW."categoryId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO selected FROM "Category" WHERE id = NEW."categoryId" AND
    ("userId" IS NULL OR "userId" = NEW."userId");
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction category is not accessible.'
      USING ERRCODE = '23503', CONSTRAINT = 'Transaction_category_accessible';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."categoryId" = OLD."categoryId" AND NEW."userId" = OLD."userId" THEN RETURN NEW; END IF;
  END IF;
  IF selected."archivedAt" IS NOT NULL OR EXISTS (
    SELECT 1 FROM "Category" WHERE id = selected."parentId" AND "archivedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Category and ancestor must be active.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_category_active';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_transfer_pair(transfer_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE movement "Transfer"%ROWTYPE;
BEGIN
  SELECT * INTO movement FROM "Transfer" WHERE id = transfer_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM "Transaction" WHERE "transferId" = transfer_id) THEN
      RAISE EXCEPTION 'Orphan transfer legs.' USING ERRCODE = '23514', CONSTRAINT = 'Transfer_balanced_pair';
    END IF;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM "Transaction" WHERE "transferId" = transfer_id) <> 2 OR EXISTS (
    SELECT 1 FROM "Transaction" p WHERE p."transferId" = transfer_id AND (
      p."userId" <> movement."userId" OR p."amountMinor" <> movement."amountMinor" OR
      p.date <> movement.date OR p.note IS DISTINCT FROM movement.note OR
      p."accountId" <> CASE WHEN p.direction = 'expense' THEN movement."fromAccountId" ELSE movement."toAccountId" END
    )
  ) THEN
    RAISE EXCEPTION 'A transfer requires exactly two matching opposite postings.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transfer_balanced_pair';
  END IF;
END;
$$;
CREATE FUNCTION check_transfer_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  IF TG_TABLE_NAME = 'Transfer' THEN
    IF TG_OP = 'DELETE' THEN target := OLD.id; ELSE target := NEW.id; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN target := OLD."transferId"; ELSE target := NEW."transferId"; END IF;
  END IF;
  IF target IS NOT NULL THEN PERFORM validate_transfer_pair(target); END IF;
  RETURN NULL;
END;
$$;
-- Intermediate one-leg states are necessary within a SQL transaction, never at
-- commit. Both triggers inspect CURRENT rows, not stale queued NEW snapshots.
CREATE CONSTRAINT TRIGGER "Transfer_balanced_pair" AFTER INSERT OR UPDATE OR DELETE ON "Transfer"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transfer_pair();
CREATE CONSTRAINT TRIGGER "Transaction_balanced_pair" AFTER INSERT OR UPDATE OR DELETE ON "Transaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transfer_pair();
COMMIT;
