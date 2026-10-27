import { z } from "zod";
import type { Transport } from "./auth/transport";
import { observeTransactions } from "./transaction-history";
import {
  pageSchema,
  transactionSchema,
  type TransactionSource
} from "./transaction-data";

export function createApiTransactionSource(
  client: Transport
): TransactionSource {
  return observeTransactions({
    get: (id) =>
      client.send(
        "GET",
        `/v1/transactions/${encodeURIComponent(id)}`,
        transactionSchema
      ),
    list(filter, after) {
      const query = Object.entries({
        ...filter,
        ...(after ? { after } : {}),
        limit: "50"
      })
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
        .join("&");
      return client.send("GET", `/v1/transactions?${query}`, pageSchema);
    },
    create: (input) =>
      client.send("POST", "/v1/transactions", transactionSchema, input),
    update: (id, input) =>
      client.send(
        "PATCH",
        `/v1/transactions/${encodeURIComponent(id)}`,
        transactionSchema,
        input
      ),
    async remove(id) {
      await client.send(
        "DELETE",
        `/v1/transactions/${encodeURIComponent(id)}`,
        z.object({ ok: z.literal(true) })
      );
    }
  });
}
