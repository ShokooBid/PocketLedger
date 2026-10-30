import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { errorSchema } from "../auth/routes.js";
import {
  cursorSchema,
  transactionInput,
  transactionPatch,
  transactionQuery,
  transactionSchema
} from "./contracts.js";
import type { TransactionService } from "./service.js";

export function registerTransactionRoutes(
  instance: FastifyInstance,
  service: TransactionService
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 415, 422, 429, 500].map((code) => [
      code,
      errorSchema
    ])
  );
  const secured = { tags: ["Transactions"], security: [{ bearerAuth: [] }] };
  const params = z.strictObject({ id: z.uuid() });
  const empty = z.strictObject({});
  app.get(
    "/v1/transactions",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Owned transactions, date descending then UUID descending. limit 1–100 (default 50); after is nextCursor. Optional inclusive from/to must be supplied together, at most 366 days apart. categoryId and direction combine with AND. Pagination is live, not a snapshot.",
        querystring: transactionQuery,
        response: {
          ...errors,
          200: z.object({
            items: z.array(transactionSchema),
            nextCursor: cursorSchema.nullable()
          })
        }
      }
    },
    async (request) => service.list(request.principal!.userId, request.query)
  );
  app.get(
    "/v1/transactions/:id",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: empty,
        response: { ...errors, 200: transactionSchema }
      }
    },
    async (request) => service.get(request.principal!.userId, request.params.id)
  );
  app.post(
    "/v1/transactions",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Positive integer minor units up to 2147483647. Supported currencies: CAD/USD/EUR/GBP/INR (2 decimals), JPY (0), KWD (3). Real calendar dates 0001–9999. Merchant 1–200 UTF-16 units with visible text; note nullable, up to 2000 units. Text is preserved; control, format and surrogate characters are rejected. Category must be owned and active. Activated currency preferences enforce the configured denomination and lock it atomically with the first posting.",
        body: transactionInput,
        querystring: empty,
        response: { ...errors, 201: transactionSchema }
      }
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.create(request.principal!.userId, request.body))
  );
  app.patch(
    "/v1/transactions/:id",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Partial update; at least one field. Retaining an existing archived category is allowed; a different category must be owned and active.",
        params,
        body: transactionPatch,
        querystring: empty,
        response: { ...errors, 200: transactionSchema }
      }
    },
    async (request) =>
      service.update(request.principal!.userId, request.params.id, request.body)
  );
  app.delete(
    "/v1/transactions/:id",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: empty,
        response: { ...errors, 200: z.object({ ok: z.literal(true) }) }
      }
    },
    async (request) =>
      service.remove(request.principal!.userId, request.params.id)
  );
}
