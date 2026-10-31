BEGIN;
ALTER TABLE "Category"
  ADD COLUMN "parentId" UUID,
  ADD COLUMN "defaultKey" VARCHAR(100),
  ADD COLUMN "iconKey" VARCHAR(40) NOT NULL DEFAULT 'category',
  ADD COLUMN "colorKey" VARCHAR(40) NOT NULL DEFAULT 'neutral',
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Category_parent_owner_fkey" FOREIGN KEY ("parentId", "userId")
    REFERENCES "Category"(id, "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Category_default_identity" CHECK ("defaultKey" IS NULL OR
    ("isDefault" AND "defaultKey" ~ '^[a-z][a-z0-9_.-]{0,99}$')),
  ADD CONSTRAINT "Category_presentation" CHECK (
    "iconKey" ~ '^[a-z][a-z0-9_-]{0,39}$' AND
    "colorKey" ~ '^[a-z][a-z0-9_-]{0,39}$' AND "sortOrder" BETWEEN 0 AND 1000000);

CREATE UNIQUE INDEX "Category_userId_defaultKey_key" ON "Category"("userId", "defaultKey");
CREATE INDEX "Category_userId_parentId_archivedAt_idx" ON "Category"("userId", "parentId", "archivedAt");
-- Existing rows remain roots, with IDs, timestamps and transaction links intact.
CREATE UNIQUE INDEX "Category_active_root_name_key" ON "Category" (
  "userId", (translate(btrim(regexp_replace(name, E'[ \t\n\r\f' || chr(11) || ']+', ' ', 'g')),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
) WHERE "archivedAt" IS NULL AND "parentId" IS NULL;
CREATE UNIQUE INDEX "Category_active_sibling_name_key" ON "Category" (
  "userId", "parentId", (translate(btrim(regexp_replace(name, E'[ \t\n\r\f' || chr(11) || ']+', ' ', 'g')),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
) WHERE "archivedAt" IS NULL AND "parentId" IS NOT NULL;
DROP INDEX "Category_userId_active_name_key";

CREATE FUNCTION enforce_category_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "Category"%ROWTYPE;
BEGIN
  -- All category/posting paths serialize on the same owner as currency writes.
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."parentId" IS DISTINCT FROM OLD."parentId" THEN
      RAISE EXCEPTION 'Category parent cannot be changed.'
        USING ERRCODE = '23514', CONSTRAINT = 'Category_parent_immutable';
    END IF;
    IF OLD."isDefault" AND (NEW.name IS DISTINCT FROM OLD.name OR
      NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" OR
      NEW."isDefault" IS DISTINCT FROM OLD."isDefault" OR
      NEW."defaultKey" IS DISTINCT FROM OLD."defaultKey" OR
      NEW."iconKey" IS DISTINCT FROM OLD."iconKey" OR
      NEW."colorKey" IS DISTINCT FROM OLD."colorKey" OR
      NEW."sortOrder" IS DISTINCT FROM OLD."sortOrder") THEN
      RAISE EXCEPTION 'Default categories are read only.'
        USING ERRCODE = '23514', CONSTRAINT = 'Category_default_read_only';
    END IF;
    IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NULL THEN
      RAISE EXCEPTION 'Category restore is unavailable.'
        USING ERRCODE = '23514', CONSTRAINT = 'Category_no_restore';
    END IF;
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    SELECT * INTO parent FROM "Category"
      WHERE id = NEW."parentId" AND "userId" = NEW."userId";
    -- The composite FK reports missing/foreign parents without disclosing them.
    IF FOUND THEN
      IF parent."parentId" IS NOT NULL OR parent.id = NEW.id OR
        (NEW."isDefault" AND NOT parent."isDefault") THEN
        RAISE EXCEPTION 'Category must belong to a root.'
          USING ERRCODE = '23514', CONSTRAINT = 'Category_depth';
      END IF;
      IF NEW."archivedAt" IS NULL AND parent."archivedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'Category parent must be active.'
          USING ERRCODE = '23514', CONSTRAINT = 'Category_parent_active';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Category_hierarchy" BEFORE INSERT OR UPDATE ON "Category"
  FOR EACH ROW EXECUTE FUNCTION enforce_category_hierarchy();

CREATE FUNCTION archive_category_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."archivedAt" IS NULL AND NEW."archivedAt" IS NOT NULL THEN
    UPDATE "Category" SET "archivedAt" = NEW."archivedAt", "updatedAt" = CURRENT_TIMESTAMP
      WHERE "parentId" = NEW.id AND "userId" = NEW."userId" AND "archivedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Category_archive_children" AFTER UPDATE OF "archivedAt" ON "Category"
  FOR EACH ROW EXECUTE FUNCTION archive_category_children();

CREATE OR REPLACE FUNCTION check_transaction_category_active() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE selected "Category"%ROWTYPE;
BEGIN
  PERFORM id FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."categoryId" = OLD."categoryId" AND NEW."userId" = OLD."userId" THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT * INTO selected FROM "Category"
    WHERE id = NEW."categoryId" AND "userId" = NEW."userId";
  IF FOUND AND (selected."archivedAt" IS NOT NULL OR EXISTS (
    SELECT 1 FROM "Category" WHERE id = selected."parentId" AND "userId" = NEW."userId"
      AND "archivedAt" IS NOT NULL
  )) THEN
    RAISE EXCEPTION 'Category and ancestor must be active.'
      USING ERRCODE = '23514', CONSTRAINT = 'Transaction_category_active';
  END IF;
  RETURN NEW;
END;
$$;
COMMIT;
