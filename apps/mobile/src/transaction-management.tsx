import { View } from "react-native";
import { CategoryIcon } from "./category-icon";
import { Body, Button, Field, StateNotice } from "./ui";
import { amountText, currencyExponents } from "./transaction-data";
import { AccountPicker, CategoryPicker } from "./finance-picker";
import { theme } from "./theme";
import {
  useTransactionManagement,
  newDraft
} from "./use-transaction-management";
export function TransactionManagement(
  props: Parameters<typeof useTransactionManagement>[0]
) {
  const {
    demo = false,
    defaultCurrency = "CAD",
    defaultAccountId = null,
    preferencesReady = true,
    onCurrencySettings,
    onAccountSettings,
    detailId,
    onOpenDetail
  } = props;
  const {
    rows,
    choices,
    accountChoices,
    accountsReady,
    accountError,
    refreshAccounts,
    accountLabel,
    categoryLabel,
    after,
    filter,
    setFilter,
    applied,
    draft,
    setDraft,
    editing,
    setEditing,
    deleting,
    setDeleting,
    busy,
    ready,
    error,
    notice,
    uncertain,
    setUncertain,
    reviewed,
    retryFilter,
    loadingMore,
    deleted,
    disabled,
    draftCurrencyMismatch,
    draftAccountUnavailable,
    draftCategoryUnavailable,
    draftHistoricalCategory,
    draftHistoricalAccount,
    picker,
    setPicker,
    selectCategory,
    selectAccount,
    load,
    mutate,
    edit,
    setError,
    pendingCreate
  } = useTransactionManagement(props);
  return (
    <>
      <View
        accessibilityElementsHidden={picker !== null}
        importantForAccessibility={picker ? "no-hide-descendants" : "auto"}
        style={{ gap: theme.space.md }}
      >
        {!preferencesReady && (
          <StateNotice
            kind="error"
            title="Currency settings need attention"
            message="Your draft is preserved. Reload currency settings before saving."
            {...(onCurrencySettings ? { onRetry: onCurrencySettings } : {})}
          />
        )}
        {demo && (
          <Body>
            Demo only: transactions stay in memory and are discarded when you
            exit. No API requests or persistent data.
          </Body>
        )}
        {busy && (
          <StateNotice
            kind="loading"
            title={loadingMore ? "Loading more transactions" : "Working"}
            message={
              loadingMore
                ? "Your current history stays visible."
                : "Please wait."
            }
          />
        )}
        {error && (
          <StateNotice
            kind="error"
            title="Transaction action needs attention"
            message={error}
          />
        )}
        {notice && <Body>{notice}</Body>}
        {accountError && (
          <StateNotice
            kind="error"
            title="Accounts need attention"
            message={accountError}
            onRetry={() => void refreshAccounts()}
          />
        )}
        {!accountsReady && !accountError && (
          <StateNotice
            kind="loading"
            title="Loading account choices"
            message="Your draft is preserved while accounts refresh."
          />
        )}
        <Button
          label="Reload transactions and categories"
          disabled={busy}
          onPress={() => void load(uncertain ? {} : (retryFilter ?? applied))}
        />
        {uncertain && (
          <>
            <Body>
              Your entered values are retained. The write may have succeeded.
              Review the reloaded list before another submission; no write is
              retried automatically.
              {pendingCreate.current &&
                " Retry protection lasts while the saved transaction exists. If it was deleted, retrying can create it again."}
            </Body>
            {pendingCreate.current ? (
              <Button
                label="Retry original save"
                disabled={busy || !reviewed || !ready}
                onPress={() => void mutate(false, true)}
              />
            ) : (
              <Button
                label="I reviewed the list; enable changes"
                disabled={busy || !reviewed || !ready}
                onPress={() => {
                  setUncertain(false);
                  setError(null);
                  setDeleting(null);
                }}
              />
            )}
          </>
        )}
        {!detailId && !draft && (
          <>
            <Body>
              {Object.values(applied).some(Boolean)
                ? `Active filters: ${applied.from ?? "any date"}${applied.to ? ` to ${applied.to}` : ""}, ${applied.direction ?? "all directions"}, ${categoryLabel(applied.categoryId, "all categories")}.`
                : "Showing all transactions."}
            </Body>
            <Field
              label="From date filter (YYYY-MM-DD)"
              value={filter.from ?? ""}
              editable={!busy}
              onChangeText={(from) => setFilter({ ...filter, from })}
            />
            <Field
              label="To date filter (YYYY-MM-DD)"
              value={filter.to ?? ""}
              editable={!busy}
              onChangeText={(to) => setFilter({ ...filter, to })}
            />
            {([undefined, "income", "expense"] as const).map((direction) => (
              <Button
                key={direction ?? "all"}
                label={`Filter: ${direction ?? "all directions"}`}
                selected={filter.direction === direction}
                disabled={busy}
                onPress={() =>
                  setFilter((previous) => {
                    const next = { ...previous };
                    if (direction) next.direction = direction;
                    else delete next.direction;
                    return next;
                  })
                }
              />
            ))}
            <Button
              label="Filter: all categories"
              disabled={busy}
              selected={!filter.categoryId}
              onPress={() =>
                setFilter((previous) => {
                  const next = { ...previous };
                  delete next.categoryId;
                  return next;
                })
              }
            />
            {choices.map((category) => (
              <Button
                key={category.id}
                label={`Filter category: ${categoryLabel(category.id)}${category.archivedAt ? " (archived)" : ""}`}
                leading={
                  !demo ? (
                    <CategoryIcon iconKey={category.iconKey} />
                  ) : undefined
                }
                selected={filter.categoryId === category.id}
                disabled={busy}
                onPress={() =>
                  setFilter({ ...filter, categoryId: category.id })
                }
              />
            ))}
            <Button
              label="Apply filters"
              disabled={busy || uncertain}
              onPress={() => void load(filter)}
            />
            <Button
              label="Clear filters"
              disabled={busy || uncertain}
              onPress={() => void load({})}
            />
            <Button
              label="Add transaction"
              variant="primary"
              disabled={disabled}
              onPress={() => edit()}
            />
          </>
        )}
        {draft && (
          <View>
            <Body>{editing ? "Edit transaction" : "New transaction"}</Body>
            {(["expense", "income"] as const).map((direction) => (
              <Button
                key={direction}
                label={direction === "expense" ? "Expense" : "Income"}
                selected={draft.direction === direction}
                disabled={busy || uncertain}
                onPress={() => setDraft({ ...draft, direction })}
              />
            ))}
            <Field
              label="Amount"
              value={draft.amount}
              keyboardType="decimal-pad"
              editable={!busy && !uncertain}
              onChangeText={(amount) => setDraft({ ...draft, amount })}
            />
            <Body>Currency: {draft.currency}</Body>
            {draftCurrencyMismatch && (
              <>
                <Body>
                  Your permanent currency is {defaultCurrency}. This draft
                  remains in {draft.currency}; its amount has not been
                  converted.
                </Body>
                {onCurrencySettings && (
                  <Button
                    label="Keep draft and open currency settings"
                    onPress={onCurrencySettings}
                    disabled={busy || uncertain}
                  />
                )}
                <Button
                  label={`Discard draft and start in ${defaultCurrency}`}
                  disabled={busy || uncertain || !preferencesReady}
                  onPress={() => {
                    setDraft({
                      ...newDraft(),
                      currency: defaultCurrency,
                      accountId: defaultAccountId ?? ""
                    });
                    setEditing(null);
                    setError(null);
                  }}
                />
              </>
            )}
            <Body>
              {currencyExponents[draft.currency]} decimal places allowed. Use a
              period as decimal separator.
            </Body>
            <Field
              label="Transaction date (YYYY-MM-DD)"
              value={draft.date}
              editable={!busy && !uncertain}
              onChangeText={(date) => setDraft({ ...draft, date })}
            />
            {accountsReady &&
              !accountChoices.some(
                (row) => !row.archivedAt && row.currency === draft.currency
              ) && (
                <>
                  <StateNotice
                    kind="empty"
                    title="Add an account to continue"
                    message="Transactions need an active account in this draft's currency. Create one in Settings, then return to this draft. Amount, category, date and note will be kept."
                  />
                  {onAccountSettings && (
                    <Button
                      label="Add an account in Settings"
                      disabled={busy || uncertain}
                      onPress={onAccountSettings}
                    />
                  )}
                </>
              )}
            {accountsReady && draftAccountUnavailable && (
              <StateNotice
                kind="error"
                title="Select an available account"
                message="The selected account is unavailable, archived or uses a different currency. Your other draft fields are preserved. Choose an active compatible account before saving."
              />
            )}
            <Button
              label={
                draft.accountId
                  ? `Account: ${accountLabel(draft.accountId)}${draftHistoricalAccount ? " (archived history)" : ""}`
                  : "Choose account"
              }
              hint="Search active accounts in this draft's currency"
              selected={!!draft.accountId && !draftAccountUnavailable}
              disabled={busy || uncertain}
              onPress={() => setPicker("account")}
            />
            {draft.accountId && (
              <Body>
                Selected account: {accountLabel(draft.accountId)}
                {draftAccountUnavailable ? " (unavailable)" : ""}
                {draftHistoricalAccount ? " (archived history)" : ""}
              </Body>
            )}
            <Button
              label={
                draft.categoryId
                  ? `Category: ${categoryLabel(draft.categoryId)}${draftHistoricalCategory ? " (archived history)" : ""}`
                  : "Choose category"
              }
              hint="Search categories, recently used selections and subcategories"
              selected={!!draft.categoryId && !draftCategoryUnavailable}
              disabled={busy || uncertain}
              onPress={() => setPicker("category")}
            />
            {draft.categoryId && (
              <Body>
                Selected category: {categoryLabel(draft.categoryId)}
                {draftCategoryUnavailable ? " (unavailable)" : ""}
                {draftHistoricalCategory ? " (archived history)" : ""}
              </Body>
            )}
            {draftCategoryUnavailable && (
              <StateNotice
                kind="error"
                title="Select an available category"
                message="This category or its parent is archived or unavailable. Choose an active category. Your other draft fields are preserved."
              />
            )}
            <Field
              label="Note (optional)"
              value={draft.note}
              maxLength={2000}
              editable={!busy && !uncertain}
              onChangeText={(note) => setDraft({ ...draft, note })}
            />
            <Button
              label="Save transaction"
              variant="primary"
              disabled={
                disabled ||
                draftCurrencyMismatch ||
                draftAccountUnavailable ||
                draftCategoryUnavailable
              }
              onPress={() => void mutate()}
            />
            <Button
              label="Cancel editing"
              disabled={busy || uncertain}
              onPress={() => {
                setDraft(null);
                setEditing(null);
              }}
            />
          </View>
        )}
        {ready && !rows.length && (
          <Body>
            {detailId
              ? deleted
                ? "Transaction deleted. Return to history to continue."
                : "This transaction is unavailable. It may have been deleted or may not belong to this account."
              : "No transactions match this view."}
          </Body>
        )}
        {rows.map((row) => (
          <View key={row.id}>
            <Body>
              {row.date} · {row.direction} ·{" "}
              {amountText(row.amountMinor, row.currency)} {row.currency} ·{" "}
              {row.note || `Transaction on ${row.date}`}
            </Body>
            <Body>
              {accountLabel(row.accountId)} · {categoryLabel(row.categoryId)}
            </Body>
            {detailId && (
              <>
                <Body>Created: {row.createdAt}</Body>
                <Body>Last updated: {row.updatedAt}</Body>
              </>
            )}
            {!detailId && onOpenDetail && (
              <Button
                label={`View details for ${row.note || `Transaction on ${row.date}`}`}
                disabled={disabled}
                onPress={() => onOpenDetail(row.id)}
              />
            )}
            <Button
              label={`Edit ${row.note || `Transaction on ${row.date}`}`}
              disabled={disabled}
              onPress={() => edit(row)}
            />
            <Button
              label={`Delete ${row.note || `Transaction on ${row.date}`}`}
              disabled={disabled}
              onPress={() => {
                setDeleting(row);
                setDraft(null);
              }}
            />
          </View>
        ))}
        {after && (
          <Button
            label="Load more transactions"
            disabled={busy}
            onPress={() => void load(applied, true)}
          />
        )}
        {deleting && (
          <View>
            <Body>
              Delete {deleting.note || `Transaction on ${deleting.date}`}? This
              permanently removes the transaction.
            </Body>
            <Button
              label="Confirm delete transaction"
              disabled={disabled}
              onPress={() => void mutate(true)}
            />
            <Button
              label="Keep transaction"
              disabled={busy || uncertain}
              onPress={() => setDeleting(null)}
            />
          </View>
        )}
      </View>
      {draft && picker === "category" && (
        <CategoryPicker
          source={props.categories}
          selectedId={draft.categoryId}
          demo={demo}
          onClose={() => setPicker(null)}
          onSelect={selectCategory}
        />
      )}
      {draft && picker === "account" && (
        <AccountPicker
          source={props.accounts}
          currency={draft.currency}
          selectedId={draft.accountId}
          onClose={() => setPicker(null)}
          onSelect={selectAccount}
          {...(onAccountSettings ? { onSettings: onAccountSettings } : {})}
        />
      )}
    </>
  );
}
