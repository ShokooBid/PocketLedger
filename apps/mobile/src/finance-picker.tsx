import type { PropsWithChildren } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import type { Account, AccountSource } from "./account-data";
import type { Category } from "./category-data";
import { categoryPath } from "./category-hierarchy";
import { CategoryIcon } from "./category-icon";
import { theme } from "./theme";
import type { Currency } from "./transaction-data";
import {
  useAccountPicker,
  useCategoryPicker,
  type CategoryPickerSource
} from "./use-finance-picker";
import { Body, Button, Field, StateNotice } from "./ui";
import { ScreenDecoration } from "./screen-decoration";

function PickerModal({
  title,
  onClose,
  onBack = onClose,
  cancelLabel = "Cancel selection",
  categoryNavigation,
  children
}: PropsWithChildren<{
  title: string;
  onClose: () => void;
  onBack?: () => void;
  cancelLabel?: string;
  categoryNavigation?: { label: string };
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
          <ScreenDecoration entry />
          {categoryNavigation ? (
            <View style={styles.categoryToolbar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={categoryNavigation.label}
                onPress={() => {
                  Keyboard.dismiss();
                  onBack();
                }}
                style={styles.toolbarButton}
              >
                <PickerSymbol kind="back" color={theme.color.onPrimary} />
              </Pressable>
              <Text accessibilityRole="header" style={styles.toolbarTitle}>
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={cancelLabel}
                onPress={() => {
                  Keyboard.dismiss();
                  onClose();
                }}
                style={styles.toolbarButton}
              >
                <PickerSymbol kind="close" color={theme.color.onPrimary} />
              </Pressable>
            </View>
          ) : (
            <>
              <Text accessibilityRole="header" style={styles.heading}>
                {title}
              </Text>
              <Button
                label={cancelLabel}
                onPress={() => {
                  Keyboard.dismiss();
                  onClose();
                }}
              />
            </>
          )}
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function PickerSymbol({
  kind,
  color = theme.color.muted
}: {
  kind: "back" | "close" | "search" | "chevron" | "check";
  color?: string;
}) {
  const paths = {
    back: "M19 12H5m7-7-7 7 7 7",
    close: "m6 6 12 12M6 18 18 6",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    chevron: "m9 5 7 7-7 7",
    check: "m5 12 4 4L19 6"
  };
  return (
    <Svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d={paths[kind]}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function PickerAction({
  label,
  children,
  disabled,
  selected,
  onPress
}: PropsWithChildren<{
  label: string;
  disabled: boolean;
  selected?: boolean;
  onPress: () => void;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pickerAction,
        (pressed || disabled) && styles.dimmed
      ]}
    >
      <Text style={styles.pickerActionText}>{children}</Text>
    </Pressable>
  );
}

export function CategoryPicker({
  source,
  selectedId,
  onSelect,
  onClose,
  mode = "entry",
  onClear
}: {
  source: CategoryPickerSource;
  selectedId: string;
  onSelect: (id: string, rows: Category[]) => void;
  onClose: () => void;
  mode?: "entry" | "filter";
  onClear?: () => void;
}) {
  const state = useCategoryPicker(
    source,
    (id, rows) => {
      Keyboard.dismiss();
      onSelect(id, rows);
    },
    mode
  );
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
  function row(category: Category, recent = false) {
    const selected = category.id === selectedId;
    const parent =
      !recent && !root && category.parentId
        ? rows?.find((item) => item.id === category.parentId)
        : null;
    return (
      <Pressable
        key={category.id}
        accessibilityRole="button"
        accessibilityLabel={`${recent ? "Recent category" : "Category"}: ${categoryPath(category, rows ?? [])}${category.archivedAt ? " (archived)" : ""}${selected ? " (selected)" : ""}`}
        accessibilityState={{
          selected,
          disabled: busy || state.needsReload || !!state.createdId
        }}
        disabled={busy || state.needsReload || !!state.createdId}
        accessibilityHint={
          category.parentId
            ? mode === "filter"
              ? "Filter History by this category"
              : "Select this category and return to your draft"
            : "Open subcategories and the parent selection action"
        }
        onPress={() => {
          if (category.parentId) void state.select(category.id);
          else {
            state.setQuery("");
            state.setRootId(category.id);
          }
        }}
        style={({ pressed }) => [
          recent ? styles.recentCategory : styles.categoryRow,
          selected &&
            (recent ? styles.recentSelected : styles.categorySelected),
          (pressed || busy || state.needsReload || !!state.createdId) &&
            styles.dimmed
        ]}
      >
        <View style={recent ? styles.recentIcon : undefined}>
          <CategoryIcon iconKey={category.iconKey} size={recent ? 56 : 44} />
        </View>
        <View style={recent ? styles.recentLabel : styles.categoryLabel}>
          <Text
            numberOfLines={recent ? 2 : undefined}
            style={recent ? styles.recentName : styles.categoryRowName}
          >
            {category.name}
            {category.archivedAt ? " (archived)" : ""}
          </Text>
          {parent && <Text style={styles.parentContext}>{parent.name}</Text>}
        </View>
        {!recent && (
          <PickerSymbol
            kind={selected ? "check" : "chevron"}
            color={selected ? theme.color.primary : theme.color.muted}
          />
        )}
      </Pressable>
    );
  }
  return (
    <PickerModal
      title="Select Category"
      onClose={onClose}
      onBack={back}
      cancelLabel={
        mode === "filter" ? "Cancel filter selection" : "Cancel selection"
      }
      categoryNavigation={{
        label: editor
          ? "Back to categories"
          : state.rootId
            ? "Back to all categories"
            : mode === "filter"
              ? "Back to History"
              : "Back to transaction"
      }}
    >
      {busy && (
        <StateNotice
          kind="loading"
          title="Loading categories"
          message={
            mode === "filter"
              ? "Your filters are preserved."
              : "Your draft is preserved."
          }
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
                {root ? (
                  <>
                    <View style={styles.categoryHeader}>
                      <CategoryIcon iconKey={root.iconKey} size={72} />
                      <View style={styles.categoryLabel}>
                        <Text
                          accessibilityRole="header"
                          style={styles.categoryName}
                        >
                          {root.name}
                          {root.archivedAt ? " (archived)" : ""}
                        </Text>
                        <PickerAction
                          label={`Use this category: ${root.name}${root.id === selectedId ? " (selected)" : ""}`}
                          selected={root.id === selectedId}
                          disabled={
                            busy || state.needsReload || !!state.createdId
                          }
                          onPress={() => void state.select(root.id)}
                        >
                          {root.id === selectedId
                            ? "Selected · Use this category"
                            : "Use this category"}
                        </PickerAction>
                      </View>
                    </View>
                    <View style={styles.categorySection}>
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        Subcategories
                      </Text>
                      <View style={styles.categoryList}>
                        {state.active
                          .filter((item) => item.parentId === root.id)
                          .map((item) => row(item))}
                      </View>
                    </View>
                    {!state.active.some(
                      (item) => item.parentId === root.id
                    ) && (
                      <Body>
                        {mode === "filter"
                          ? "No subcategories. Use this category to filter History."
                          : "No subcategories yet. Use this category or add a subcategory."}
                      </Body>
                    )}
                    {mode === "entry" && source.createChild && (
                      <PickerAction
                        label={`Add subcategory under ${root.name}`}
                        disabled={
                          busy || state.needsReload || !!state.createdId
                        }
                        onPress={() =>
                          state.setEditor({ name: "", parentId: root.id })
                        }
                      >
                        + Add subcategory
                      </PickerAction>
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
                <View style={styles.searchField}>
                  <PickerSymbol kind="search" />
                  <TextInput
                    accessibilityLabel="Search categories"
                    placeholder="Search categories"
                    placeholderTextColor={theme.color.muted}
                    value={state.query}
                    editable={!busy}
                    onChangeText={state.setQuery}
                    returnKeyType="search"
                    autoCorrect={false}
                    style={styles.searchInput}
                  />
                </View>
                {mode === "filter" && onClear && (
                  <PickerAction
                    label="All categories"
                    selected={!selectedId}
                    disabled={busy}
                    onPress={onClear}
                  >
                    All categories
                  </PickerAction>
                )}
                {state.query.trim() ? (
                  <>
                    <View style={styles.categorySection}>
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        Search results
                      </Text>
                      <View style={styles.categoryList}>
                        {state.matches.map((item) => row(item))}
                      </View>
                    </View>
                    {!state.matches.length && (
                      <StateNotice
                        kind="empty"
                        title="No matching categories"
                        message={
                          mode === "filter"
                            ? "Try another name."
                            : "Try another name or add a personal category."
                        }
                      />
                    )}
                  </>
                ) : (
                  <>
                    {source.recent && (
                      <View style={styles.categorySection}>
                        <Text
                          accessibilityRole="header"
                          style={styles.sectionTitle}
                        >
                          Recently used
                        </Text>
                        {state.recentError ? (
                          <StateNotice
                            kind="error"
                            title="Recent categories unavailable"
                            message="All categories are still available. Reload to retry recent categories."
                            onRetry={() => void state.reload()}
                          />
                        ) : (
                          <>
                            <View style={styles.recentCategories}>
                              {state.recentRows.map((item) => row(item, true))}
                            </View>
                            {!state.recentRows.length && (
                              <Body>No recently used categories.</Body>
                            )}
                          </>
                        )}
                      </View>
                    )}
                    <View style={styles.categorySection}>
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        All categories
                      </Text>
                      <View style={styles.categoryList}>
                        {state.active
                          .filter((item) => !item.parentId)
                          .map((item) => row(item))}
                      </View>
                    </View>
                    {!state.active.length && (
                      <StateNotice
                        kind="empty"
                        title={
                          mode === "filter"
                            ? "No categories"
                            : "No active categories"
                        }
                        message={
                          mode === "filter"
                            ? "There are no categories to filter by."
                            : "Add a personal category to continue."
                        }
                      />
                    )}
                  </>
                )}
                {mode === "entry" && source.create && (
                  <PickerAction
                    label="Add personal category"
                    disabled={busy || state.needsReload || !!state.createdId}
                    onPress={() => state.setEditor({ name: "" })}
                  >
                    + Add personal category
                  </PickerAction>
                )}
              </>
            )}
            <PickerAction
              label="Reload categories"
              disabled={busy}
              onPress={() => void state.reload()}
            >
              Reload categories
            </PickerAction>
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
  onSettings,
  excludeId,
  onClear,
  title = "Choose account"
}: {
  source: AccountSource;
  currency: Currency;
  selectedId: string;
  onSelect: (id: string, rows: Account[]) => void;
  onClose: () => void;
  onSettings?: () => void;
  excludeId?: string;
  onClear?: () => void;
  title?: string;
}) {
  const state = useAccountPicker(
    source,
    currency,
    (id, rows) => {
      Keyboard.dismiss();
      onSelect(id, rows);
    },
    excludeId
  );
  return (
    <PickerModal title={title} onClose={onClose}>
      <Body>Active accounts in {currency}</Body>
      {onClear && selectedId && (
        <Button
          label="Clear account selection"
          disabled={state.busy}
          onPress={() => {
            Keyboard.dismiss();
            onClear();
          }}
        />
      )}
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
    color: theme.color.onPrimary,
    fontSize: theme.font.heading,
    fontWeight: "700",
    minHeight: 88,
    padding: 12,
    borderRadius: 18,
    backgroundColor: theme.color.primary
  },
  categoryToolbar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 80,
    marginBottom: 20,
    marginHorizontal: -12,
    gap: 8
  },
  toolbarButton: {
    minWidth: theme.touchTarget,
    minHeight: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center"
  },
  toolbarTitle: {
    flex: 1,
    color: theme.color.onPrimary,
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center"
  },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.color.primarySoft,
    borderRadius: theme.pillRadius,
    paddingHorizontal: 16,
    gap: 12
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: theme.touchTarget,
    paddingVertical: 12,
    color: theme.color.text,
    fontSize: 16
  },
  categorySection: { gap: 14, marginTop: 8 },
  sectionTitle: {
    color: theme.color.text,
    fontSize: 17,
    fontWeight: "600"
  },
  categoryList: { gap: 8 },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 64,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    borderRadius: 18,
    backgroundColor: theme.color.surface
  },
  categorySelected: {
    backgroundColor: theme.color.primarySoft,
    borderColor: theme.color.primary
  },
  categoryLabel: { flex: 1, minWidth: 0 },
  categoryRowName: { color: theme.color.text, fontSize: 16, lineHeight: 22 },
  parentContext: {
    color: theme.color.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2
  },
  recentCategories: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  recentCategory: {
    width: "25%",
    flexShrink: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 16
  },
  recentIcon: { padding: 2 },
  recentLabel: { alignSelf: "stretch" },
  recentSelected: {
    borderColor: theme.color.primary,
    backgroundColor: theme.color.primarySoft
  },
  recentName: {
    color: theme.color.text,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center"
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 8
  },
  pickerAction: {
    minHeight: theme.touchTarget,
    justifyContent: "center",
    paddingVertical: 10
  },
  pickerActionText: {
    color: theme.color.primary,
    fontSize: 14,
    fontWeight: "600"
  },
  dimmed: { opacity: 0.6 },
  categoryName: {
    color: theme.color.text,
    fontSize: 24,
    fontWeight: "700"
  }
});
