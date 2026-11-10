import { z } from "zod";
import type { AccountSource } from "./account-data";
import { ClientFailure, type Transport } from "./auth/transport";
import {
  calendarDate,
  currencySchema,
  type Currency
} from "./transaction-data";

// A transfer selects existing accounts. Currency is derived; category has no role.
export const transferInput = z.strictObject({
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  amountMinor: z.number().int().min(1).max(2147483647),
  date: calendarDate,
  note: z
    .string()
    .max(2000)
    .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value))
    .nullable()
    .default(null)
});
export const transferCreate = transferInput.extend({
  clientRequestId: z.uuid()
});
export const transferPatch = transferInput
  .extend({ note: transferInput.shape.note.removeDefault() })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const transferSchema = transferInput.extend({
  id: z.uuid(),
  currency: currencySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
const cursor = z
  .string()
  .refine(
    (value) =>
      value.length === 47 &&
      value[10] === "_" &&
      calendarDate.safeParse(value.slice(0, 10)).success &&
      z.uuid().safeParse(value.slice(11)).success
  );
const filterSchema = z
  .strictObject({
    accountId: z.uuid().optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional()
  })
  .refine(
    (value) =>
      (!value.from && !value.to) ||
      (!!value.from &&
        !!value.to &&
        value.from <= value.to &&
        Date.parse(value.to) - Date.parse(value.from) <= 366 * 86400000)
  );
const pageSchema = z.object({
  items: z.array(transferSchema),
  nextCursor: cursor.nullable()
});
export type Transfer = z.infer<typeof transferSchema>;
export type TransferInput = z.infer<typeof transferInput>;
export type TransferCreate = z.infer<typeof transferCreate>;
export type TransferPatch = z.infer<typeof transferPatch>;
export type TransferFilter = z.infer<typeof filterSchema>;
export type TransferChange =
  { type: "saved"; row: Transfer } | { type: "deleted"; id: string };
export interface TransferSource {
  subscribe(listener: (change: TransferChange) => void): () => void;
  list(
    filter?: TransferFilter,
    after?: string
  ): Promise<z.infer<typeof pageSchema>>;
  get(id: string): Promise<Transfer>;
  create(input: TransferCreate): Promise<Transfer>;
  update(id: string, patch: TransferPatch): Promise<Transfer>;
  remove(id: string): Promise<void>;
}
// Publish whole aggregates after confirmed writes. Observers cannot fail a write.
function observeTransfers(
  source: Omit<TransferSource, "subscribe">
): TransferSource {
  const listeners = new Set<(change: TransferChange) => void>();
  function publish(change: TransferChange) {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {
        /* Keep confirmed writes successful. */
      }
    }
  }
  return {
    ...source,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async create(input) {
      const row = await source.create(input);
      publish({ type: "saved", row });
      return row;
    },
    async update(id, patch) {
      const row = await source.update(id, patch);
      publish({ type: "saved", row });
      return row;
    },
    async remove(id) {
      await source.remove(id);
      publish({ type: "deleted", id });
    }
  };
}
export function transferFailureMessage(error: unknown) {
  if (error instanceof ClientFailure) {
    if (error.code === "INVALID_ACCOUNT")
      return "An account was archived or is not open on this date. Reload accounts and repair the draft.";
    if (error.code === "CURRENCY_MISMATCH")
      return "Choose two accounts in the transfer's original currency. Amounts are never converted.";
    if (error.code === "INVALID_TRANSFER")
      return "Choose different From and To accounts.";
    if (error.kind === "unavailable")
      return "This transfer or account is unavailable. Reload before continuing.";
    if (error.code === "IDEMPOTENCY_KEY_REUSED")
      return "This save identity belongs to different content. Review saved transfers before starting another draft.";
    if (error.kind === "validation")
      return "Check the amount, both active accounts, date and description. Your draft is kept.";
    if (error.kind === "rate-limit")
      return "Too many requests. Wait before trying again.";
  }
  return "The transfer change could not be confirmed. Keep this draft and check saved transfers before retrying.";
}
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ClientFailure("validation");
  return result.data;
}
export function createApiTransferSource(client: Transport): TransferSource {
  const path = (id: string) => `/v1/transfers/${checked(z.uuid(), id)}`;
  return observeTransfers({
    list(filter = {}, after) {
      const query = Object.entries({
        ...checked(filterSchema, filter),
        ...(after === undefined ? {} : { after: checked(cursor, after) }),
        limit: 50
      })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join("&");
      return client.send("GET", `/v1/transfers?${query}`, pageSchema);
    },
    get: (id) => client.send("GET", path(id), transferSchema),
    // Caller retains the creation key and original payload for uncertain retries.
    create: (value) =>
      client.send(
        "POST",
        "/v1/transfers",
        transferSchema,
        checked(transferCreate, { ...value, note: value.note || null })
      ),
    update: (id, patch) =>
      client.send(
        "PATCH",
        path(id),
        transferSchema,
        checked(transferPatch, patch)
      ),
    async remove(id) {
      await client.send("DELETE", path(id), z.object({ ok: z.literal(true) }));
    }
  });
}

// Internal demo composition: account archival and transfer writes share a queue.
// A single aggregate replacement makes both derived balance legs atomic in memory.
export function createDemoTransferLedger(
  accounts: Pick<AccountSource, "list">,
  getCurrency: () => Currency,
  write: <T>(action: () => Promise<T>) => Promise<T>,
  beforeCreate?: (currency: Currency) => void
) {
  type Stored = {
    resource: Transfer;
    clientRequestId: string;
    fingerprint: string;
  };
  let rows: Stored[] = [],
    sequence = 0;
  const missing = () => new ClientFailure("unavailable");
  const find = (id: string) => {
    const canonicalId = checked(z.uuid(), id).toLowerCase();
    const row = rows.find((item) => item.resource.id === canonicalId);
    if (!row) throw missing();
    return row;
  };
  const canonical = (value: z.infer<typeof transferInput>) => ({
    ...value,
    fromAccountId: value.fromAccountId.toLowerCase(),
    toAccountId: value.toAccountId.toLowerCase(),
    note: value.note || null
  });
  async function eligible(
    input: z.infer<typeof transferInput>,
    previous?: Currency
  ) {
    if (input.fromAccountId === input.toAccountId)
      throw new ClientFailure("validation", "INVALID_TRANSFER");
    const all = await accounts.list(),
      from = all.find((row) => row.id === input.fromAccountId),
      to = all.find((row) => row.id === input.toAccountId);
    if (!from || !to) throw missing();
    if (
      from.archivedAt ||
      to.archivedAt ||
      input.date < from.openingDate ||
      input.date < to.openingDate
    )
      throw new ClientFailure("validation", "INVALID_ACCOUNT");
    if (
      from.currency !== to.currency ||
      from.currency !== getCurrency() ||
      (previous && previous !== from.currency)
    )
      throw new ClientFailure("validation", "CURRENCY_MISMATCH");
    return from.currency;
  }
  const source: Omit<TransferSource, "subscribe"> = {
    async list(filter = {}, after) {
      const query = checked(filterSchema, filter);
      if (after !== undefined) checked(cursor, after);
      const accountId = query.accountId?.toLowerCase();
      if (
        accountId &&
        !(await accounts.list()).some((row) => row.id === accountId)
      )
        throw missing();
      const sorted = rows
        .map((row) => row.resource)
        .filter(
          (row) =>
            (!accountId ||
              row.fromAccountId === accountId ||
              row.toAccountId === accountId) &&
            (!query.from || row.date >= query.from) &&
            (!query.to || row.date <= query.to) &&
            (!after || `${row.date}_${row.id}` < after)
        )
        .sort((a, b) => `${b.date}_${b.id}`.localeCompare(`${a.date}_${a.id}`));
      const items = sorted.slice(0, 50).map((row) => ({ ...row })),
        last = items.at(-1);
      return {
        items,
        nextCursor:
          sorted.length > 50 && last ? `${last.date}_${last.id}` : null
      };
    },
    async get(id) {
      return { ...find(id).resource };
    },
    create(value) {
      return write(async () => {
        const { clientRequestId, ...fields } = checked(transferCreate, value),
          input = canonical(fields);
        // Canonical text in memory; the server persists SHA-256 of this same tuple.
        const fingerprint = JSON.stringify([
          input.fromAccountId,
          input.toAccountId,
          input.amountMinor,
          input.date,
          input.note
        ]);
        const previous = rows.find(
          (row) => row.clientRequestId === clientRequestId.toLowerCase()
        );
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new ClientFailure("conflict", "IDEMPOTENCY_KEY_REUSED");
          return { ...previous.resource };
        }
        const currency = await eligible(input),
          now = new Date().toISOString();
        beforeCreate?.(currency);
        const resource = {
          ...input,
          currency,
          id: `30000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
          createdAt: now,
          updatedAt: now
        };
        rows.push({
          resource,
          clientRequestId: clientRequestId.toLowerCase(),
          fingerprint
        });
        return { ...resource };
      });
    },
    update(id, patch) {
      return write(async () => {
        const previous = find(id),
          old = previous.resource;
        const input = canonical(
          checked(transferInput, {
            fromAccountId: old.fromAccountId,
            toAccountId: old.toAccountId,
            amountMinor: old.amountMinor,
            date: old.date,
            note: old.note,
            ...checked(transferPatch, patch)
          })
        );
        const currency = await eligible(input, old.currency);
        const resource = {
          ...old,
          ...input,
          currency,
          updatedAt: new Date().toISOString()
        };
        rows = rows.map((row) =>
          row === previous ? { ...row, resource } : row
        );
        return { ...resource };
      });
    },
    remove(id) {
      return write(async () => {
        const row = find(id);
        rows = rows.filter((item) => item !== row);
      });
    }
  };
  return {
    source: observeTransfers(source),
    balanceAdjustment(accountId: string, asOf: string) {
      return rows.reduce(
        (sum, { resource: row }) =>
          row.date > asOf
            ? sum
            : sum +
              (row.toAccountId === accountId
                ? BigInt(row.amountMinor)
                : row.fromAccountId === accountId
                  ? -BigInt(row.amountMinor)
                  : 0n),
        0n
      );
    }
  };
}
