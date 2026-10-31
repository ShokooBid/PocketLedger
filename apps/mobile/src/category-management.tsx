import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { CategoryIcon } from "./category-icon";
import {
  CategoryFailure,
  categoryFailureMessage,
  type Category,
  type CategorySource
} from "./category-data";
import { Body, Button, Field, StateNotice } from "./ui";
import {
  activeCategoryChildren,
  categoryPath,
  orderedCategories
} from "./category-hierarchy";

export function CategoryManagement({
  source,
  demo = true
}: {
  source: CategorySource;
  demo?: boolean;
}) {
  const [rows, setRows] = useState<Category[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<{
    id?: string;
    name: string;
    parentId?: string;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<Category | null>(null);
  const visibleRows = (
    source.hierarchy ? orderedCategories(rows) : rows
  ).filter((row) =>
    showArchived ? row.archivedAt !== null : row.archivedAt === null
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    setStatus("loading");
    source
      .list()
      .then((items) => {
        if (active) {
          setRows(items);
          setStatus("ready");
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          if (failure instanceof CategoryFailure)
            setError(categoryFailureMessage(failure));
          setStatus("error");
        }
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [source]);

  async function reload() {
    if (locked.current) return;
    locked.current = true;
    setStatus("loading");
    try {
      const items = await source.list();
      if (mounted.current) {
        setRows(items);
        setStatus("ready");
        setError(null);
      }
    } catch (failure) {
      if (mounted.current) {
        if (failure instanceof CategoryFailure)
          setError(categoryFailureMessage(failure));
        setStatus("error");
      }
    } finally {
      locked.current = false;
    }
  }
  async function mutate(write: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    let written = false;
    try {
      await write();
      written = true;
      if (!mounted.current) return;
      // Close only after success. A failed write keeps the form and user's input.
      setEditor(null);
      setConfirmation(null);
      const items = await source.list();
      if (mounted.current) {
        setRows(items);
        setStatus("ready");
      }
    } catch (failure) {
      if (mounted.current) {
        setError(categoryFailureMessage(failure));
        // A write may have succeeded before reloading failed. Do not offer a
        // blind write retry against stale data; reload is the recovery action.
        if (
          written ||
          (failure instanceof CategoryFailure && failure.code === "uncertain")
        ) {
          setEditor(null);
          setConfirmation(null);
          setStatus("error");
        }
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (status === "loading")
    return (
      <StateNotice
        kind="loading"
        title="Loading categories"
        message="Preparing the category list."
      />
    );
  if (status === "error")
    return (
      <StateNotice
        kind="error"
        title="Categories unavailable"
        message={error ?? "The list could not be loaded. Try again."}
        onRetry={() => {
          void reload();
        }}
      />
    );
  return (
    <>
      {error && (
        <StateNotice
          kind="error"
          title="Category change failed"
          message={error}
        />
      )}
      {busy && (
        <StateNotice
          kind="loading"
          title="Saving category"
          message="Please wait for this change to finish."
        />
      )}
      {editor ? (
        <>
          <Body>{editor.id ? "Edit category" : "Add category"}</Body>
          {editor.parentId && (
            <Body>
              Under {rows.find((row) => row.id === editor.parentId)?.name}
            </Body>
          )}
          <Field
            label="Category name"
            value={editor.name}
            editable={!busy}
            maxLength={1000}
            onChangeText={(name) => setEditor({ ...editor, name })}
            autoFocus
          />
          <Body>
            Use 1–100 characters. Extra spaces are collapsed. Active names that
            differ only by A–Z case count as duplicates; other letters remain
            distinct.
          </Body>
          <Button
            label="Save category"
            variant="primary"
            disabled={busy}
            onPress={() => {
              void mutate(() =>
                editor.id
                  ? source.rename(editor.id, editor.name)
                  : editor.parentId && source.createChild
                    ? source.createChild(editor.name, editor.parentId)
                    : source.create(editor.name)
              );
            }}
          />
          <Button
            label="Cancel editing"
            disabled={busy}
            onPress={() => {
              setEditor(null);
              setError(null);
            }}
          />
        </>
      ) : confirmation ? (
        <>
          <Body>
            Archive{" "}
            {source.hierarchy
              ? categoryPath(confirmation, rows)
              : confirmation.name}
            ?
          </Body>
          {source.hierarchy &&
            activeCategoryChildren(confirmation, rows).length > 0 && (
              <Body>
                Also archives:{" "}
                {activeCategoryChildren(confirmation, rows)
                  .map((row) => row.name)
                  .join(", ")}
                . Past transactions keep their associations.
              </Body>
            )}
          <Body>
            Past transactions keep this category. It will no longer be available
            for new transactions. You can create a new category with the same
            name. Restore is not available.
          </Body>
          <Button
            label="Confirm archive"
            disabled={busy}
            onPress={() => {
              void mutate(() => source.archive(confirmation.id));
            }}
          />
          <Button
            label="Cancel archive"
            disabled={busy}
            onPress={() => {
              setConfirmation(null);
              setError(null);
            }}
          />
        </>
      ) : (
        <>
          <Button
            label="Add category"
            disabled={busy}
            onPress={() => {
              setError(null);
              setEditor({ name: "" });
            }}
          />
          <Button
            label={
              showArchived
                ? "Show active categories"
                : "Show archived categories"
            }
            disabled={busy}
            onPress={() => setShowArchived(!showArchived)}
          />
          {visibleRows.length === 0 && (
            <StateNotice
              kind="empty"
              title="Nothing here yet"
              message={
                showArchived
                  ? `There are no archived ${demo ? "demo " : ""}categories.`
                  : `Add your first ${demo ? "demo " : ""}category.`
              }
            />
          )}
          {visibleRows.map((row) => (
            <View key={row.id}>
              <View style={styles.categoryHeading}>
                {!demo && <CategoryIcon iconKey={row.iconKey} />}
                <View style={styles.categoryName}>
                  <Body>
                    {source.hierarchy ? categoryPath(row, rows) : row.name}
                    {row.isDefault ? " (default)" : ""}
                    {row.archivedAt ? " (archived)" : ""}
                  </Body>
                </View>
              </View>
              {source.hierarchy && !row.archivedAt && !row.parentId && (
                <Button
                  label={`Add subcategory under ${row.name}`}
                  disabled={busy}
                  onPress={() => {
                    setError(null);
                    setEditor({ name: "", parentId: row.id });
                  }}
                />
              )}
              {!row.archivedAt && !row.isDefault && (
                <>
                  <Button
                    label={`Edit ${source.hierarchy ? categoryPath(row, rows) : row.name}`}
                    disabled={busy}
                    onPress={() => {
                      setError(null);
                      setEditor({ id: row.id, name: row.name });
                    }}
                  />
                  <Button
                    label={`Archive ${source.hierarchy ? categoryPath(row, rows) : row.name}`}
                    disabled={busy}
                    onPress={() => {
                      setError(null);
                      setConfirmation(row);
                    }}
                  />
                </>
              )}
            </View>
          ))}
          <Button
            label="Reload categories"
            disabled={busy}
            onPress={() => {
              void reload();
            }}
          />
        </>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  categoryHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  categoryName: { flex: 1 }
});
