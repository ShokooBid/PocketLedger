import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { View } from "react-native";
import {
  createDemoCategorySource,
  categoryFailureMessage,
  type Category,
  type CategorySource
} from "./category-data";
import { Body, Button, Field, StateNotice } from "./ui";

const DemoCategories = createContext<CategorySource | null>(null);
// Mounted only inside the demo branch. Navigation retains data; exiting drops it.
export function DemoCategoriesProvider({ children }: PropsWithChildren) {
  const [source] = useState(createDemoCategorySource);
  return (
    <DemoCategories.Provider value={source}>{children}</DemoCategories.Provider>
  );
}
export function useDemoCategories() {
  const source = useContext(DemoCategories);
  if (!source) throw new Error("DemoCategoriesProvider is required.");
  return source;
}

export function CategoryManagement({ source }: { source: CategorySource }) {
  const [rows, setRows] = useState<Category[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<{ id?: string; name: string } | null>(
    null
  );
  const [confirmation, setConfirmation] = useState<Category | null>(null);
  const visibleRows = rows.filter((row) =>
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
      .catch(() => {
        if (active) setStatus("error");
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
    } catch {
      if (mounted.current) setStatus("error");
    } finally {
      locked.current = false;
    }
  }
  async function mutate(write: () => Promise<void>) {
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
        if (written) setStatus("error");
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
        message="The list could not be loaded. Try again."
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
            disabled={busy}
            onPress={() => {
              void mutate(() =>
                editor.id
                  ? source.rename(editor.id, editor.name)
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
          <Body>Archive {confirmation.name}?</Body>
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
                  ? "There are no archived demo categories."
                  : "Add your first demo category."
              }
            />
          )}
          {visibleRows.map((row) => (
            <View key={row.id}>
              <Body>
                {row.name}
                {row.isDefault ? " (default)" : ""}
                {row.archivedAt ? " (archived)" : ""}
              </Body>
              {!row.archivedAt && (
                <>
                  <Button
                    label={`Edit ${row.name}`}
                    disabled={busy}
                    onPress={() => {
                      setError(null);
                      setEditor({ id: row.id, name: row.name });
                    }}
                  />
                  <Button
                    label={`Archive ${row.name}`}
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
