import { z } from "zod";
import { ClientFailure, type Transport } from "./auth/transport";
import {
  calendarDate,
  currencySchema,
  currencyExponents,
  createDemoTransactionSource,
  type Currency
} from "./transaction-data";
import type { CategorySource } from "./category-data";

export const accountInput = z.strictObject({
  name: z
    .string()
    .max(1000)
    .transform((value) =>
      value.replace(/[ \t\n\r\f\v]+/g, " ").replace(/^ | $/g, "")
    )
    .pipe(
      z
        .string()
        .min(1)
        .max(100)
        .refine(
          (value) => /\S/u.test(value) && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)
        )
    ),
  type: z.enum(["cash", "bank", "credit", "other"]),
  currency: currencySchema,
  openingBalanceMinor: z
    .number()
    .int()
    .min(-2147483647)
    .max(2147483647)
    .default(0),
  openingDate: calendarDate
});
export const accountSchema = accountInput.extend({
  id: z.uuid(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
const detail = accountSchema.extend({
  asOf: calendarDate,
  balanceMinor: z.number().int()
});
export type Account = z.infer<typeof accountSchema>;
export type AccountInput = z.infer<typeof accountInput>;
export interface AccountSource {
  list(): Promise<Account[]>;
  get(id: string, asOf?: string): Promise<z.infer<typeof detail>>;
  create(input: AccountInput): Promise<Account>;
  update(
    id: string,
    patch: { name?: string; type?: Account["type"] }
  ): Promise<Account>;
  archive(id: string): Promise<Account>;
}
export function parseOpeningBalance(raw: string, currency: Currency) {
  if (raw === "") return 0;
  if (raw.length > 31 || !/^-?\d+(?:\.\d+)?$/.test(raw))
    throw new ClientFailure("validation");
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = (negative ? raw.slice(1) : raw).split(".");
  if (fraction.length > currencyExponents[currency])
    throw new ClientFailure("validation");
  const value = BigInt(
    whole! + fraction.padEnd(currencyExponents[currency], "0")
  );
  if (value > 2147483647n) throw new ClientFailure("validation");
  return (negative ? -1 : 1) * Number(value);
}
export function createApiAccountSource(client: Transport): AccountSource {
  const path = (id: string) => `/v1/accounts/${z.uuid().parse(id)}`;
  return {
    async list() {
      const rows: Account[] = [],
        seen = new Set<string>();
      let after: string | null = null;
      do {
        const result: { items: Account[]; nextCursor: string | null } =
          await client.send(
            "GET",
            `/v1/accounts?status=all&limit=100${after ? `&after=${after}` : ""}`,
            z.object({
              items: z.array(accountSchema),
              nextCursor: z.uuid().nullable()
            })
          );
        rows.push(...result.items);
        after = result.nextCursor;
        if (after && (seen.has(after) || !result.items.length))
          throw new ClientFailure("protocol");
        if (after) seen.add(after);
      } while (after);
      return rows;
    },
    get: (id, asOf) =>
      client.send(
        "GET",
        path(id) + (asOf ? `?asOf=${calendarDate.parse(asOf)}` : ""),
        detail
      ),
    create: (input) =>
      client.send(
        "POST",
        "/v1/accounts",
        accountSchema,
        accountInput.parse(input)
      ),
    update: (id, patch) => client.send("PATCH", path(id), accountSchema, patch),
    archive: (id) =>
      client.send("POST", `${path(id)}/archive`, accountSchema, {})
  };
}

// One memory ledger backs both demo ports. Opening balances affect account
// balances only; they never become income or lock the entry currency.
export function createDemoFinanceSources(
  categories: CategorySource,
  getCurrency: () => Currency,
  beforeWrite?: Parameters<typeof createDemoTransactionSource>[2]
) {
  let rows: Account[] = [],
    sequence = 0;
  const missing = () => new ClientFailure("unavailable");
  function checkedName(input: AccountInput, except?: string) {
    const name = input.name
      .replace(/[ \t\n\r\f\v]+/g, " ")
      .replace(/^ | $/g, "");
    const fold = (value: string) =>
      value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    if (
      rows.some(
        (row) =>
          row.id !== except && !row.archivedAt && fold(row.name) === fold(name)
      )
    )
      throw new ClientFailure("conflict", "ACCOUNT_NAME_CONFLICT");
    return name;
  }
  const accounts: AccountSource = {
    list: async () => rows.map((row) => ({ ...row })),
    async get(id, asOf = new Date().toISOString().slice(0, 10)) {
      const row = rows.find((row) => row.id === id);
      if (!row) throw missing();
      if (asOf < row.openingDate)
        throw new ClientFailure("validation", "INVALID_ACCOUNT");
      let balance = BigInt(row.openingBalanceMinor),
        after: string | undefined;
      do {
        const page = await transactions.list({ accountId: id }, after);
        for (const posting of page.items)
          if (posting.date <= asOf)
            balance +=
              (posting.direction === "income" ? 1n : -1n) *
              BigInt(posting.amountMinor);
        after = page.nextCursor ?? undefined;
      } while (after);
      if (
        balance > BigInt(Number.MAX_SAFE_INTEGER) ||
        balance < BigInt(Number.MIN_SAFE_INTEGER)
      )
        throw new ClientFailure("validation", "SUMMARY_AMOUNT_OUT_OF_RANGE");
      return { ...row, asOf, balanceMinor: Number(balance) };
    },
    async create(value) {
      const input = accountInput.parse(value);
      if (input.currency !== getCurrency())
        throw new ClientFailure("conflict", "PREFERENCE_CHANGED");
      const name = checkedName(input),
        now = new Date().toISOString();
      const row = {
        ...input,
        name,
        id: `20000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
        archivedAt: null,
        createdAt: now,
        updatedAt: now
      };
      rows.push(row);
      return { ...row };
    },
    async update(id, patch) {
      const row = rows.find((row) => row.id === id);
      if (!row) throw missing();
      if (row.archivedAt)
        throw new ClientFailure("conflict", "ACCOUNT_ARCHIVED");
      const input = accountInput.parse({
        name: patch.name ?? row.name,
        type: patch.type ?? row.type,
        currency: row.currency,
        openingDate: row.openingDate,
        openingBalanceMinor: row.openingBalanceMinor
      });
      const updated = {
        ...row,
        ...patch,
        name: checkedName(input, id),
        updatedAt: new Date().toISOString()
      };
      rows = rows.map((row) => (row.id === id ? updated : row));
      return { ...updated };
    },
    async archive(id) {
      const row = rows.find((row) => row.id === id);
      if (!row) throw missing();
      if (!row.archivedAt) {
        row.archivedAt = new Date().toISOString();
        row.updatedAt = row.archivedAt;
      }
      return { ...row };
    }
  };
  const transactions = createDemoTransactionSource(
    categories,
    accounts,
    (input, previous) => {
      if (!previous && input.currency !== getCurrency())
        throw new ClientFailure("validation", "CURRENCY_MISMATCH");
      beforeWrite?.(input, previous);
    }
  );
  return { accounts, transactions };
}
