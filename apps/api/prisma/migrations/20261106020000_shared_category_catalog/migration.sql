-- Hand-written: shared defaults have no owner; personal rows remain private.
-- Apply from a clean development database. No reset, adoption or backfill here.
BEGIN;
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_categoryId_userId_fkey",
  ADD CONSTRAINT "Transaction_category_fkey" FOREIGN KEY ("categoryId")
    REFERENCES "Category" (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Category" DROP CONSTRAINT "Category_parent_owner_fkey",
  DROP CONSTRAINT "Category_default_identity", ALTER COLUMN "userId" DROP NOT NULL,
  ADD CONSTRAINT "Category_parent_fkey" FOREIGN KEY ("parentId")
    REFERENCES "Category" (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Category_default_identity" CHECK (
    ("userId" IS NULL AND "isDefault" AND "defaultKey" IS NOT NULL AND
      "defaultKey" ~ '^[a-z][a-z0-9_.-]{0,99}$' AND "archivedAt" IS NULL) OR
    ("userId" IS NOT NULL AND NOT "isDefault" AND "defaultKey" IS NULL)
  );
DROP INDEX "Category_id_userId_key";
DROP INDEX "Category_userId_defaultKey_key";
CREATE UNIQUE INDEX "Category_defaultKey_key" ON "Category" ("defaultKey");

CREATE FUNCTION category_name_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT translate(btrim(regexp_replace(value, E'[ \t\n\r\f' || chr(11) || ']+', ' ', 'g')),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C"
$$;
-- Existing owner-scoped indexes still enforce personal sibling uniqueness.
-- NULL owners require explicit shared indexes, including the root namespace.
CREATE UNIQUE INDEX "Category_active_shared_root_name_key"
  ON "Category" ((category_name_key(name) COLLATE "C"))
  WHERE "userId" IS NULL AND "parentId" IS NULL AND "archivedAt" IS NULL;
CREATE UNIQUE INDEX "Category_active_shared_sibling_name_key"
  ON "Category" ("parentId", (category_name_key(name) COLLATE "C"))
  WHERE "userId" IS NULL AND "parentId" IS NOT NULL AND "archivedAt" IS NULL;

CREATE OR REPLACE FUNCTION lock_category_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."userId" IS NOT NULL THEN
    PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    PERFORM id FROM "Category" WHERE id = NEW."parentId" AND
      ("userId" IS NULL OR "userId" = NEW."userId") FOR SHARE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_category_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "Category"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."userId" IS NULL THEN
      RAISE EXCEPTION 'Shared categories are read only.'
        USING ERRCODE = '23514', CONSTRAINT = 'Category_default_read_only';
    END IF;
    PERFORM id FROM "User" WHERE id = OLD."userId" FOR UPDATE;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."userId" IS DISTINCT FROM OLD."userId" OR
      NEW."parentId" IS DISTINCT FROM OLD."parentId" THEN
      RAISE EXCEPTION 'Category identity, ownership and parent are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'Category_parent_immutable';
    END IF;
    IF OLD."userId" IS NULL AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Shared categories are read only.'
        USING ERRCODE = '23514', CONSTRAINT = 'Category_default_read_only';
    END IF;
    IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NULL THEN
      RAISE EXCEPTION 'Category restore is unavailable.'
        USING ERRCODE = '23514', CONSTRAINT = 'Category_no_restore';
    END IF;
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    SELECT * INTO parent FROM "Category" WHERE id = NEW."parentId";
    IF FOUND THEN
      IF parent."userId" IS NOT NULL AND parent."userId" IS DISTINCT FROM NEW."userId" THEN
        RAISE EXCEPTION 'Category parent is not accessible.'
          USING ERRCODE = '23503', CONSTRAINT = 'Category_parent_accessible';
      END IF;
      IF parent."parentId" IS NOT NULL OR parent.id = NEW.id THEN
        RAISE EXCEPTION 'Category must belong to a root.'
          USING ERRCODE = '23514', CONSTRAINT = 'Category_depth';
      END IF;
      IF NEW."archivedAt" IS NULL AND parent."archivedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'Category parent must be active.'
          USING ERRCODE = '23514', CONSTRAINT = 'Category_parent_active';
      END IF;
    END IF;
  END IF;
  IF NEW."archivedAt" IS NULL THEN
    -- Shared insertion and personal writes use the same name/parent lock.
    PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_SCHEMA || ':category-name:' ||
      COALESCE(NEW."parentId"::text, 'root') || ':' || category_name_key(NEW.name), 0));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER "Category_hierarchy" ON "Category";
CREATE TRIGGER "Category_hierarchy" BEFORE INSERT OR UPDATE OR DELETE ON "Category"
  FOR EACH ROW EXECUTE FUNCTION enforce_category_hierarchy();

CREATE OR REPLACE FUNCTION validate_category_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_row "Category"%ROWTYPE; parent "Category"%ROWTYPE;
BEGIN
  SELECT * INTO current_row FROM "Category" WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF current_row."parentId" IS NOT NULL THEN
    SELECT * INTO parent FROM "Category" WHERE id = current_row."parentId";
    IF FOUND THEN
      IF parent."userId" IS NOT NULL AND parent."userId" IS DISTINCT FROM current_row."userId" THEN
        RAISE EXCEPTION 'Category parent is not accessible.'
          USING ERRCODE = '23503', CONSTRAINT = 'Category_parent_accessible';
      END IF;
      IF parent.id = current_row.id OR parent."parentId" IS NOT NULL OR
        (current_row."archivedAt" IS NULL AND parent."archivedAt" IS NOT NULL) THEN
        RAISE EXCEPTION 'Category requires an active accessible root.'
          USING ERRCODE = '23514', CONSTRAINT = 'Category_parent_valid';
      END IF;
    END IF;
  END IF;
  IF current_row."archivedAt" IS NULL AND EXISTS (
    SELECT 1 FROM "Category" c WHERE c.id <> current_row.id AND c."archivedAt" IS NULL
      AND c."parentId" IS NOT DISTINCT FROM current_row."parentId"
      AND (current_row."userId" IS NULL OR c."userId" IS NULL OR c."userId" = current_row."userId")
      AND category_name_key(c.name) COLLATE "C" = category_name_key(current_row.name) COLLATE "C"
  ) THEN
    RAISE EXCEPTION 'An active visible sibling already uses this name.'
      USING ERRCODE = '23505', CONSTRAINT = 'Category_visible_sibling_name_key';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION lock_transaction_category_path() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."categoryId" = OLD."categoryId" AND NEW."userId" = OLD."userId" THEN RETURN NEW; END IF;
  END IF;
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  PERFORM id FROM "Category" WHERE ("userId" IS NULL OR "userId" = NEW."userId") AND (
    id = NEW."categoryId" OR id = (SELECT "parentId" FROM "Category"
      WHERE id = NEW."categoryId" AND ("userId" IS NULL OR "userId" = NEW."userId"))
  ) ORDER BY id FOR SHARE;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION check_transaction_category_active() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected "Category"%ROWTYPE;
BEGIN
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  -- Access is enforced on every assignment, including direct writes.
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
COMMIT;
