import { describe, expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react-native";
import { TransactionManagement } from "../src/transaction-management";
import {
  amountText,
  createDemoTransactionSource,
  parseAmount,
  validDateFilter,
  type Currency,
  type TransactionSource
} from "../src/transaction-data";
import { createDemoCategorySource } from "../src/category-data";
import { ClientFailure } from "../src/auth/transport";
async function press(name: string) {
  await act(async () => {
    await fireEvent.press(screen.getByRole("button", { name }));
  });
}
async function field(label: string, value: string) {
  await act(async () => {
    await fireEvent.changeText(screen.getByLabelText(label), value);
  });
}
async function setup(wrap?: (source: TransactionSource) => TransactionSource) {
  const categories = createDemoCategorySource();
  await categories.create("Food");
  const source =
    wrap?.(createDemoTransactionSource(categories)) ??
    createDemoTransactionSource(categories);
  render(
    <TransactionManagement source={source} categories={categories} demo />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Add transaction" })
    ).toBeEnabled()
  );
  return { source, categories };
}
async function fill() {
  await press("Add transaction");
  await field("Amount", "1.01");
  await field("Transaction date (YYYY-MM-DD)", "2024-02-29");
  await field("Merchant or payee", "Synthetic shop");
  await field("Note (optional)", "Retained note");
  await press("Category: Food");
}
describe("exact amount conversion", () => {
  it("validates inclusive bounded date filters as calendar dates", () => {
    expect(validDateFilter({})).toBe(true);
    expect(validDateFilter({ from: "2024-02-29", to: "2024-02-29" })).toBe(
      true
    );
    for (const filter of [
      { from: "2023-02-29", to: "2023-03-01" },
      { from: "2024-01-01" },
      { from: "2024-02-01", to: "2024-01-01" },
      { from: "2024-01-01", to: "2026-01-01" }
    ])
      expect(validDateFilter(filter)).toBe(false);
  });
  it.each([
    ["0.01", "USD", 1],
    ["1.01", "EUR", 101],
    ["21474836.47", "GBP", 2147483647],
    ["0001.2", "INR", 120],
    ["2147483647", "JPY", 2147483647],
    ["1.001", "KWD", 1001]
  ] as [string, Currency, number][])(
    "converts %s %s exactly",
    (raw, currency, expected) => {
      expect(parseAmount(raw, currency)).toBe(expected);
      expect(parseAmount(amountText(expected, currency), currency)).toBe(
        expected
      );
    }
  );
  it.each([
    "0",
    "-1",
    "1e2",
    "1,00",
    "1.001",
    "NaN",
    "Infinity",
    ".1",
    "1.",
    "21474836.48",
    " ",
    "1\n"
  ])("rejects %s", (raw) => expect(() => parseAmount(raw, "USD")).toThrow());
  it("rejects fractions for JPY and excessive KWD precision", () => {
    expect(() => parseAmount("1.1", "JPY")).toThrow();
    expect(() => parseAmount("1.0001", "KWD")).toThrow();
  });
});
describe("transaction management", () => {
  it("keeps a confirmed save visible when the follow-up read fails and never replays the write", async () => {
    let create: ReturnType<typeof jest.fn<TransactionSource["create"]>>;
    await setup((source) => {
      create = jest.fn(source.create);
      return {
        ...source,
        create,
        list: jest
          .fn<TransactionSource["list"]>()
          .mockResolvedValueOnce({ items: [], nextCursor: null })
          .mockRejectedValueOnce(new ClientFailure("network"))
          .mockImplementation(source.list)
      };
    });
    await fill();
    await press("Save transaction");
    expect(screen.getByText(/1.01 USD/)).toBeVisible();
    expect(screen.queryByLabelText("Amount")).toBeNull();
    expect(screen.getByRole("alert")).toHaveProp(
      "accessibilityLabel",
      expect.stringContaining("Transaction saved, but")
    );
    await press("Reload transactions and categories");
    expect(create!).toHaveBeenCalledTimes(1);
  });
  it("retains invalid values, saves exact amounts, edits historical categories and confirms deletion", async () => {
    const { source, categories } = await setup();
    await fill();
    await field("Amount", "0");
    await press("Save transaction");
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "0");
    expect(screen.getByRole("alert")).toBeVisible();
    await field("Amount", "1.01");
    await press("Save transaction");
    expect(screen.getByText(/1.01 USD/)).toBeVisible();
    expect((await source.list({})).items[0]).toMatchObject({
      amountMinor: 101,
      date: "2024-02-29",
      note: "Retained note"
    });
    await categories.archive((await categories.list())[0]!.id);
    await press("Reload transactions and categories");
    await press("Edit Synthetic shop");
    expect(
      screen.getByRole("button", { name: "Category: Food (archived history)" })
    ).toBeVisible();
    await field("Merchant or payee", "Edited shop");
    await press("Save transaction");
    await press("Delete Edited shop");
    await press("Keep transaction");
    expect((await source.list({})).items).toHaveLength(1);
    await press("Delete Edited shop");
    await press("Confirm delete transaction");
    expect((await source.list({})).items).toHaveLength(0);
  });
  it("retains a draft after validation failure and allows correction", async () => {
    const create = jest
      .fn<TransactionSource["create"]>()
      .mockRejectedValue(new ClientFailure("validation"));
    await setup((source) => ({ ...source, create }));
    await fill();
    await press("Save transaction");
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "1.01");
    expect(screen.getByLabelText("Note (optional)")).toHaveProp(
      "value",
      "Retained note"
    );
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeEnabled();
  });
  it("blocks duplicate pending submits and retains uncertain draft until an explicit read and review", async () => {
    let reject!: (error: unknown) => void;
    const create = jest.fn<TransactionSource["create"]>(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        })
    );
    await setup((source) => ({ ...source, create }));
    await fill();
    await press("Save transaction");
    await press("Save transaction");
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => reject(new ClientFailure("network")));
    expect(screen.getByLabelText("Merchant or payee")).toHaveProp(
      "value",
      "Synthetic shop"
    );
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "I reviewed the list; enable changes"
      })
    ).toBeDisabled();
    await press("Reload transactions and categories");
    expect(create).toHaveBeenCalledTimes(1);
    await press("I reviewed the list; enable changes");
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeEnabled();
  });
  it("shows read recovery without enabling writes until reload succeeds", async () => {
    await setup((source) => ({
      ...source,
      list: jest
        .fn<TransactionSource["list"]>()
        .mockResolvedValueOnce({ items: [], nextCursor: null })
        .mockRejectedValueOnce(new ClientFailure("network"))
        .mockResolvedValue({ items: [], nextCursor: null })
    }));
    await press("Reload transactions and categories");
    expect(
      screen.getByRole("button", { name: "Add transaction" })
    ).toBeDisabled();
    await press("Reload transactions and categories");
    expect(
      screen.getByRole("button", { name: "Add transaction" })
    ).toBeEnabled();
  });
});
