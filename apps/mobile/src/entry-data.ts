import type { Account } from "./account-data";
import type { Category } from "./category-data";
import { selectableCategory } from "./category-hierarchy";
import { transferInput } from "./transfer-data";
import {
  calendarDate,
  currencyExponents,
  currencySchema,
  draftInput,
  parseAmount,
  type Currency,
  type TransactionDraft
} from "./transaction-data";

export type EntryDraft = Omit<TransactionDraft, "direction"> & {
  direction: TransactionDraft["direction"] | "transfer";
  toAccountId: string;
};

export function localDate(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function freshEntry(currency: Currency, accountId = ""): EntryDraft {
  return {
    direction: "expense",
    amount: "",
    currency,
    accountId,
    categoryId: "",
    toAccountId: "",
    date: localDate(),
    note: ""
  };
}

// Text while editing, integer minor units only at submission. A trailing dot is
// allowed during editing; confirming it means the whole amount (e.g. 12. -> 12).
export function keypadAmount(value: string, key: string, currency: Currency) {
  if (key === "backspace") return value.slice(0, -1);
  const precision = currencyExponents[currency];
  if (key === ".")
    return precision && !value.includes(".") ? `${value || "0"}.` : value;
  if (!/^\d$/.test(key)) return value;
  const next = value === "0" ? key : value + key;
  const [whole, fraction = ""] = next.split(".");
  if (fraction.length > precision || next.length > 30) return value;
  const units = BigInt(whole! + fraction.padEnd(precision, "0"));
  return units > 2147483647n ? value : next;
}

export type EntryField =
  "amount" | "accountId" | "categoryId" | "toAccountId" | "date" | "note";
export type EntryErrors = Partial<Record<EntryField, string>>;

export function entryErrors(
  draft: EntryDraft,
  accounts: Account[],
  categories: Category[]
): EntryErrors {
  const errors: EntryErrors = {};
  const account = accounts.find(
    (row) => row.id === draft.accountId && !row.archivedAt
  );
  if (!account) errors.accountId = "Choose an active account.";
  else if (account.currency !== draft.currency)
    errors.accountId =
      "Choose an account in the draft's original currency; amounts are never converted.";
  try {
    parseAmount(
      draft.amount.replace(/\.$/, ""),
      account?.currency ?? draft.currency
    );
  } catch {
    errors.amount = `Enter a positive amount with up to ${currencyExponents[account?.currency ?? draft.currency]} decimal places and at most 2147483647 minor units.`;
  }
  const destination = accounts.find((row) => row.id === draft.toAccountId);
  if (draft.direction === "transfer") {
    if (!destination || destination.archivedAt)
      errors.toAccountId = "Choose an active To account.";
    else if (destination.id === draft.accountId)
      errors.toAccountId = "From and To must be different accounts.";
    else if (
      destination.currency !== draft.currency ||
      (account && destination.currency !== account.currency)
    )
      errors.toAccountId =
        "Choose a To account in the same currency. No conversion occurs.";
  } else {
    const category = categories.find((row) => row.id === draft.categoryId);
    if (!category || !selectableCategory(category, categories))
      errors.categoryId = "Choose an active category or subcategory.";
  }
  if (!calendarDate.safeParse(draft.date).success)
    errors.date = "Choose a real calendar date.";
  else if (account && draft.date < account.openingDate)
    errors.date = `Choose a date on or after ${account.openingDate}, when this account opened.`;
  else if (
    draft.direction === "transfer" &&
    destination &&
    draft.date < destination.openingDate
  )
    errors.date = `Choose a date on or after ${destination.openingDate}, when the To account opened.`;
  if (draft.note.length > 2000 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(draft.note))
    errors.note = "Use up to 2000 characters without control characters.";
  return errors;
}

export function entryInput(draft: EntryDraft, account: Account) {
  if (draft.direction === "transfer")
    throw new Error("Use the transfer aggregate input.");
  return draftInput(
    {
      ...draft,
      direction: draft.direction,
      amount: draft.amount.replace(/\.$/, "")
    },
    account
  );
}

export function transferEntryInput(draft: EntryDraft) {
  return transferInput.parse({
    fromAccountId: draft.accountId,
    toAccountId: draft.toAccountId,
    amountMinor: parseAmount(draft.amount.replace(/\.$/, ""), draft.currency),
    date: draft.date,
    note: draft.note || null
  });
}

// Old currency parameters are assertions, never a preference write or conversion.
export function parseAddLink(date: unknown, currency: unknown) {
  const parsedDate =
    date === undefined ? undefined : calendarDate.safeParse(date);
  const parsedCurrency =
    currency === undefined ? undefined : currencySchema.safeParse(currency);
  if (
    (parsedDate && !parsedDate.success) ||
    (parsedCurrency && !parsedCurrency.success)
  )
    return null;
  return {
    ...(parsedDate?.success ? { date: parsedDate.data } : {}),
    ...(parsedCurrency?.success ? { currency: parsedCurrency.data } : {})
  };
}
