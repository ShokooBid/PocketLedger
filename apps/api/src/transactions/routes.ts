import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { errorSchema } from "../auth/routes.js";
import { cursorSchema } from "./contracts.js";
import {
  transactionCreate,
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
  const params = z.strictObject({ id: z.uuid() }),
    empty = z.strictObject({});
  app.get(
    "/v1/transactions",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        querystring: transactionQuery,
        description:
          "Normal transactions only. Date/UUID descending keyset pagination; bounded date/account/category/direction/currency filters combine with AND. includeSubcategories requires categoryId.",
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
        querystring: empty,
        body: transactionCreate,
        description:
          "Required owned active account/category and UUID clientRequestId. Positive exact integer minor units in the account currency, date on or after account opening. Currency is derived from the account in responses and is rejected in request bodies. No merchant or client provenance. Same owner/key/payload replays with 200; changed payload or replay after deletion returns 409.",
        response: {
          ...errors,
          200: transactionSchema,
          201: transactionSchema
        }
      }
    },
    async (request, reply) => {
      const result = await service.create(
        request.principal!.userId,
        request.body
      );
      return reply.code(result.replayed ? 200 : 201).send(result.resource);
    }
  );
  app.patch(
    "/v1/transactions/:id",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: empty,
        body: transactionPatch,
        description:
          "Nonempty partial update without currency. Account reassignment must retain the original account currency; amounts are never converted. Identity/provenance are immutable. Unchanged archived account/category associations may remain; changed selections must be active. Opening-date guards always apply.",
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
