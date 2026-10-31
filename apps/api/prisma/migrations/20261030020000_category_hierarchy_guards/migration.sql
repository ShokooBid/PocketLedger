-- Validate the final rows too: multi-row INSERT can reference a parent inserted
-- later in the same statement, invisible to the BEFORE-row hierarchy guard.
CREATE FUNCTION validate_category_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Category" c JOIN "Category" p
      ON p.id = c."parentId" AND p."userId" = c."userId"
    WHERE c.id = NEW.id AND c."userId" = NEW."userId" AND (
      c.id = p.id OR p."parentId" IS NOT NULL OR
      (c."archivedAt" IS NULL AND p."archivedAt" IS NOT NULL) OR
      (c."isDefault" AND NOT p."isDefault")
    )
  ) THEN
    RAISE EXCEPTION 'Category requires an active owned root.'
      USING ERRCODE = '23514', CONSTRAINT = 'Category_parent_valid';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "Category_parent_valid"
  AFTER INSERT OR UPDATE ON "Category" DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION validate_category_parent();
