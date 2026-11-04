import type { PropsWithChildren } from "react";
import { Keyboard, Modal, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Account, AccountSource } from "./account-data";
import type { Category, CategorySource } from "./category-data";
import { categoryPath } from "./category-hierarchy";
import { CategoryIcon } from "./category-icon";
import { theme } from "./theme";
import type { Currency } from "./transaction-data";
import { useAccountPicker, useCategoryPicker } from "./use-finance-picker";
import { Body, Button, Field, StateNotice } from "./ui";

function PickerModal({
  title,
  onClose,
  onBack = onClose,
  children
}: PropsWithChildren<{
  title: string;
  onClose: () => void;
  onBack?: () => void;
}>) {
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        Keyboard.dismiss();
        onBack();
      }}
      onShow={() => Keyboard.dismiss()}
    >
      <SafeAreaView style={styles.surface}>
        <ScrollView
          accessibilityViewIsModal
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
        >
          <Text accessibilityRole="header" style={styles.heading}>
            {title}
          </Text>
          <Button
            label="Cancel selection"
            onPress={() => {
              Keyboard.dismiss();
              onClose();
            }}
          />
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function CategoryPicker({
  source,
  selectedId,
  onSelect,
  onClose,
  demo = false
}: {
  source: CategorySource;
  selectedId: string;
  onSelect: (id: string, rows: Category[]) => void;
  onClose: () => void;
  demo?: boolean;
}) {
  const state = useCategoryPicker(source, (id, rows) => {
    Keyboard.dismiss();
    onSelect(id, rows);
  });
  const { rows, busy, error, root, editor } = state;
  function back() {
    if (busy) {
      onClose();
      return;
    }
    if (editor) state.setEditor(null);
    else if (state.rootId) state.setRootId(null);
    else onClose();
  }
  function row(category: Category, prefix = "Category") {
    const selected = category.id === selectedId;
    return (
      <Button
        key={category.id}
        label={`${prefix}: ${categoryPath(category, rows ?? [])}${selected ? " (selected)" : ""}`}
        selected={selected}
        disabled={busy || state.needsReload || !!state.createdId}
        leading={
          !demo ? <CategoryIcon iconKey={category.iconKey} /> : undefined
        }
        hint={
          category.parentId
            ? "Select this category and return to your draft"
            : "Open subcategories and the parent selection action"
        }
        onPress={() => {
          if (category.parentId) void state.select(category.id);
          else {
            state.setQuery("");
            state.setRootId(category.id);
          }
        }}
      />
    );
  }
  return (
    <PickerModal title="Choose category" onClose={onClose} onBack={back}>
      {busy && (
        <StateNotice
          kind="loading"
          title="Loading categories"
          message="Your draft is preserved."
        />
      )}
      {error && (
        <StateNotice
          kind="error"
          title="Category selection needs attention"
          message={error}
          onRetry={() => void state.reload()}
        />
      )}
      {state.createdId && (
        <>
          <Body>
            Category created. Retry selecting the confirmed category; it will
            not be created again.
          </Body>
          <Button
            label="Select created category"
            disabled={busy}
            onPress={() => void state.select(state.createdId!)}
          />
          <Button
            label="Choose another category"
            disabled={busy}
            onPress={() => state.setCreatedId(null)}
          />
        </>
      )}
      {editor ? (
        <>
          <Body>
            {editor.parentId
              ? `Add subcategory under ${root?.name ?? "category"}`
              : "Add personal root category"}
          </Body>
          <Field
            label="Category name"
            value={editor.name}
            editable={!busy}
            maxLength={1000}
            onChangeText={(name) => state.setEditor({ ...editor, name })}
          />
          <Body>
            Use a visible name of 1–100 characters. Extra spaces are collapsed.
          </Body>
          <Button
            label="Create and select category"
            disabled={busy}
            onPress={() => void state.create()}
          />
          <Button
            label="Cancel category creation"
            disabled={busy}
            onPress={() => state.setEditor(null)}
          />
        </>
      ) : (
        rows && (
          <>
            {state.rootId ? (
              <>
                <Button
                  label="Back to all categories"
                  disabled={busy}
                  onPress={() => state.setRootId(null)}
                />
                {root ? (
                  <>
                    <Body>{root.name}</Body>
                    <Button
                      label={`Use this category: ${root.name}${root.id === selectedId ? " (selected)" : ""}`}
                      selected={root.id === selectedId}
                      disabled={busy || state.needsReload || !!state.createdId}
                      onPress={() => void state.select(root.id)}
                    />
                    {state.active
                      .filter((item) => item.parentId === root.id)
                      .map((item) => row(item))}
                    {!state.active.some(
                      (item) => item.parentId === root.id
                    ) && (
                      <Body>
                        No subcategories yet. Use this category or add a
                        subcategory.
                      </Body>
                    )}
                    {source.createChild && (
                      <Button
                        label={`Add subcategory under ${root.name}`}
                        disabled={
                          busy || state.needsReload || !!state.createdId
                        }
                        onPress={() =>
                          state.setEditor({ name: "", parentId: root.id })
                        }
                      />
                    )}
                  </>
                ) : (
                  <Body>
                    This category is no longer available. Return to all
                    categories.
                  </Body>
                )}
              </>
            ) : (
              <>
                <Field
                  label="Search categories"
                  value={state.query}
                  editable={!busy}
                  onChangeText={state.setQuery}
                  returnKeyType="search"
                />
                {state.query.trim() ? (
                  <>
                    <Body>Search results</Body>
                    {state.matches.map((item) => row(item))}
                    {!state.matches.length && (
                      <StateNotice
                        kind="empty"
                        title="No matching categories"
                        message="Try another name or add a personal category."
                      />
                    )}
                  </>
                ) : (
                  <>
                    <Body>Recently used</Body>
                    {state.recentError ? (
                      <StateNotice
                        kind="error"
                        title="Recent categories unavailable"
                        message="All categories are still available. Reload to retry recent categories."
                        onRetry={() => void state.reload()}
                      />
                    ) : (
                      <>
                        {state.recentRows.map((item) =>
                          row(item, "Recent category")
                        )}
                        {!state.recentRows.length && (
                          <Body>No recently used categories.</Body>
                        )}
                      </>
                    )}
                    <Body>All categories</Body>
                    {state.active
                      .filter((item) => !item.parentId)
                      .map((item) => row(item))}
                    {!state.active.length && (
                      <StateNotice
                        kind="empty"
                        title="No active categories"
                        message="Add a personal category to continue."
                      />
                    )}
                  </>
                )}
                <Button
                  label="Add personal category"
                  disabled={busy || state.needsReload || !!state.createdId}
                  onPress={() => state.setEditor({ name: "" })}
                />
              </>
            )}
            <Button
              label="Reload categories"
              disabled={busy}
              onPress={() => void state.reload()}
            />
          </>
        )
      )}
    </PickerModal>
  );
}

export function AccountPicker({
  source,
  currency,
  selectedId,
  onSelect,
  onClose,
  onSettings
}: {
  source: AccountSource;
  currency: Currency;
  selectedId: string;
  onSelect: (id: string, rows: Account[]) => void;
  onClose: () => void;
  onSettings?: () => void;
}) {
  const state = useAccountPicker(source, currency, (id, rows) => {
    Keyboard.dismiss();
    onSelect(id, rows);
  });
  return (
    <PickerModal title="Choose account" onClose={onClose}>
      <Body>Active accounts in {currency}</Body>
      <Field
        label="Search accounts"
        value={state.query}
        onChangeText={state.setQuery}
        returnKeyType="search"
      />
      {state.busy && (
        <StateNotice
          kind="loading"
          title="Loading accounts"
          message="Your draft is preserved."
        />
      )}
      {state.error && (
        <StateNotice
          kind="error"
          title="Account selection needs attention"
          message={state.error}
          onRetry={() => void state.reload()}
        />
      )}
      {state.rows && (
        <>
          {!state.available.length ? (
            <StateNotice
              kind="empty"
              title="No compatible accounts"
              message="Create an active account in this draft's currency in Settings, then return here."
            />
          ) : (
            !state.matches.length && (
              <StateNotice
                kind="empty"
                title="No matching accounts"
                message="Try another account name."
              />
            )
          )}
          {state.matches.map((row) => (
            <Button
              key={row.id}
              label={`Account: ${row.name}${row.id === selectedId ? " (selected)" : ""}`}
              selected={row.id === selectedId}
              disabled={state.busy}
              onPress={() => void state.select(row.id)}
            />
          ))}
        </>
      )}
      <Button
        label="Reload accounts"
        disabled={state.busy}
        onPress={() => void state.reload()}
      />
      {onSettings && (
        <Button
          label="Add an account in Settings"
          onPress={() => {
            onClose();
            onSettings();
          }}
        />
      )}
    </PickerModal>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, backgroundColor: theme.color.background },
  content: {
    padding: theme.space.lg,
    paddingBottom: 96,
    gap: theme.space.md,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center"
  },
  heading: {
    color: theme.color.primary,
    fontSize: theme.font.heading,
    fontWeight: "700"
  }
});
