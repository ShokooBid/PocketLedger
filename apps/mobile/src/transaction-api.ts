import { z } from "zod";
import { ClientFailure, type Transport } from "./auth/transport";
import {
  calendarDate,
  currencySchema,
  transactionPatch,
  transactionSchema,
  transactionCreate,
  pageSchema,
  type TransactionSource
} from "./transaction-data";
import { observeTransactions } from "./transaction-history";

// The portable form port also serves memory fixtures; HTTP identifiers are UUIDs.
const createBody = transactionCreate.extend({
  accountId: z.uuid(),
  categoryId: z.uuid()
});
const patchBody = transactionPatch.safeExtend({
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional()
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
const filters = z
  .strictObject({
    accountId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    currency: currencySchema.optional(),
    direction: z.enum(["income", "expense"]).optional(),
    includeSubcategories: z.boolean().optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional()
  })
  .refine(
    (q) =>
      (!q.includeSubcategories || !!q.categoryId) &&
      ((!q.from && !q.to) ||
        (!!q.from &&
          !!q.to &&
          q.from <= q.to &&
          Date.parse(q.to) - Date.parse(q.from) <= 366 * 86400000))
  );

function validated<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ClientFailure("validation");
  return result.data;
}
export function createApiTransactionSource(
  client: Transport
): TransactionSource {
  const path = (id: string) => `/v1/transactions/${validated(z.uuid(), id)}`;
  return observeTransactions({
    get: (id: string) => client.send("GET", path(id), transactionSchema),
    list(filter: z.infer<typeof filters> = {}, after?: string) {
      const checked = validated(filters, filter);
      if (after !== undefined) validated(cursor, after);
      const query = Object.entries({
        ...checked,
        ...(after ? { after } : {}),
        limit: 50
      })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join("&");
      return client.send("GET", `/v1/transactions?${query}`, pageSchema);
    },
    // The caller owns this UUID/payload for the draft's lifetime. This adapter
    // never creates another key and never automatically retries an uncertain write.
    create: (value) =>
      client.send(
        "POST",
        "/v1/transactions",
        transactionSchema,
        validated(createBody, {
          ...value,
          note: value.note || null
        })
      ),
    update: (id: string, value) =>
      client.send(
        "PATCH",
        path(id),
        transactionSchema,
        validated(patchBody, value)
      ),
    async remove(id: string) {
      await client.send("DELETE", path(id), z.object({ ok: z.literal(true) }));
    }
  });
}
