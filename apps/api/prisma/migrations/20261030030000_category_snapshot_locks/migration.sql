-- Owner locks serialize normal READ COMMITTED writes. Category row locks also
-- reject stale REPEATABLE READ snapshots after another transaction archives a
-- category: waiting on an unchanged owner row alone does not refresh a snapshot.
CREATE FUNCTION lock_category_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF NEW."parentId" IS NOT NULL THEN
    PERFORM id FROM "Category" WHERE id = NEW."parentId" AND "userId" = NEW."userId" FOR SHARE;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Category_ancestor_locks" BEFORE INSERT OR UPDATE ON "Category"
  FOR EACH ROW EXECUTE FUNCTION lock_category_parent();

CREATE FUNCTION lock_transaction_category_path() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."categoryId" = OLD."categoryId" AND NEW."userId" = OLD."userId" THEN
      RETURN NEW;
    END IF;
  END IF;
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  PERFORM id FROM "Category" WHERE "userId" = NEW."userId" AND (
    id = NEW."categoryId" OR id = (
      SELECT "parentId" FROM "Category" WHERE id = NEW."categoryId" AND "userId" = NEW."userId"
    )
  ) ORDER BY id FOR SHARE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Transaction_category_ancestor_locks"
  BEFORE INSERT OR UPDATE OF "categoryId", "userId" ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION lock_transaction_category_path();
