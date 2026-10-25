-- Hand-written: Prisma cannot represent this expression/partial unique index.
-- Build it before dropping the old index; collisions fail atomically for review.
-- Do not rename, merge, delete or reassign existing categories automatically.
BEGIN;
CREATE UNIQUE INDEX "Category_userId_active_name_key" ON "Category" (
  "userId",
  (translate(
    btrim(regexp_replace(name, E'[ \t\n\r\f' || chr(11) || ']+', ' ', 'g')),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'
  ) COLLATE "C")
) WHERE "archivedAt" IS NULL;
DROP INDEX "Category_userId_name_key";

-- Existing historical links stay valid. Only a NEW assignment must be active.
-- SHARE locks serialize assignment with a concurrent category archive.
CREATE FUNCTION check_transaction_category_active() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE archived timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."categoryId" = OLD."categoryId" AND NEW."userId" = OLD."userId" THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT "archivedAt" INTO archived FROM "Category"
    WHERE id = NEW."categoryId" AND "userId" = NEW."userId" FOR SHARE;
  IF archived IS NOT NULL THEN
    RAISE EXCEPTION 'An archived category cannot receive a new assignment.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_category_active';
  END IF;
  -- Missing/foreign IDs are rejected by the existing composite foreign key.
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Transaction_category_active"
BEFORE INSERT OR UPDATE OF "categoryId", "userId" ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION check_transaction_category_active();
COMMIT;
