import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { errorSchema } from "../auth/routes.js";
import { cursorSchema } from "../transactions/contracts.js";
import {
  transferCreate,
  transferPatch,
  transferQuery,
  transferSchema
} from "./contracts.js";
import type { TransferService } from "./service.js";

export function registerTransferRoutes(
  instance: FastifyInstance,
  service: TransferService
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 415, 422, 429, 500].map((code) => [
      code,
      errorSchema
    ])
  );
  const secured = { tags: ["Transfers"], security: [{ bearerAuth: [] }] },
    params = z.strictObject({ id: z.uuid() }),
    empty = z.strictObject({});
  app.get(
    "/v1/transfers",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        querystring: transferQuery,
        response: {
          ...errors,
          200: z.object({
            items: z.array(transferSchema),
            nextCursor: cursorSchema.nullable()
          })
        }
      }
    },
    async (req) => service.list(req.principal!.userId, req.query)
  );
  app.get(
    "/v1/transfers/:id",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: empty,
        response: { ...errors, 200: transferSchema }
      }
    },
    async (req) => service.get(req.principal!.userId, req.params.id)
  );
  app.post(
    "/v1/transfers",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        querystring: empty,
        body: transferCreate,
        description:
          "Move exact minor units between distinct active owned accounts with the same immutable currency. No category, currency, leg identities or client fingerprint. Create both postings atomically. Same owner/key/original payload replays current state with 200; changed content conflicts. Hard deletion releases the key, so later retries may create again.",
        response: { ...errors, 200: transferSchema, 201: transferSchema }
      }
    },
    async (req, reply) => {
      const result = await service.create(req.principal!.userId, req.body);
      return reply.code(result.replayed ? 200 : 201).send(result.resource);
    }
  );
  app.patch(
    "/v1/transfers/:id",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: empty,
        body: transferPatch,
        description:
          "Update the aggregate and both postings together, retaining creation identity. Both accounts must remain active; archived transfers may be read or hard-deleted. Account reassignment cannot change denomination.",
        response: { ...errors, 200: transferSchema }
      }
    },
    async (req) =>
      service.update(req.principal!.userId, req.params.id, req.body)
  );
  app.delete(
    "/v1/transfers/:id",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: empty,
        response: { ...errors, 200: z.object({ ok: z.literal(true) }) }
      }
    },
    async (req) => service.remove(req.principal!.userId, req.params.id)
  );
}
