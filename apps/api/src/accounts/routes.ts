import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { errorSchema } from "../auth/routes.js";
import {
  accountBalanceQuery,
  accountDetailSchema,
  accountInput,
  accountPatch,
  accountQuery,
  accountSchema
} from "./contracts.js";
import type { AccountService } from "./service.js";

export function registerAccountRoutes(
  instance: FastifyInstance,
  service: AccountService
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 415, 422, 429, 500].map((code) => [
      code,
      errorSchema
    ])
  );
  const secured = { tags: ["Accounts"], security: [{ bearerAuth: [] }] };
  const empty = z.strictObject({});
  const params = z.strictObject({ id: z.uuid() });
  const base = "/v1/accounts";
  app.get(
    base,
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Owned named accounts, gated off by default. UUID-keyset pagination; defaults to active accounts. Names do not imply a bank connection.",
        querystring: accountQuery,
        response: {
          ...errors,
          200: z.object({
            items: z.array(accountSchema).max(100),
            nextCursor: z.uuid().nullable()
          })
        }
      }
    },
    (request) => service.list(request.principal!.userId, request.query)
  );
  app.get(
    `${base}/:id`,
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: accountBalanceQuery,
        description:
          "Owned account including archived records. Balance asOf defaults to the UTC calendar date; dates before opening are rejected. Until #69 links postings, balances contain only the opening baseline.",
        response: { ...errors, 200: accountDetailSchema }
      }
    },
    (request) =>
      service.get(
        request.principal!.userId,
        request.params.id,
        request.query.asOf
      )
  );
  app.post(
    base,
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        querystring: empty,
        body: accountInput,
        description:
          "Create a user-named account inheriting the permanent currency choice. Currency asserts that choice; stale assertions return PREFERENCE_CHANGED. Signed opening balance defaults to zero and is not income. No bank credentials or connection.",
        response: { ...errors, 201: accountSchema }
      }
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.create(request.principal!.userId, request.body))
  );
  app.patch(
    `${base}/:id`,
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: empty,
        body: accountPatch,
        description:
          "Nonempty name/type patch on an active owned account. Currency and opening information are immutable, including before first use.",
        response: { ...errors, 200: accountSchema }
      }
    },
    (request) =>
      service.update(request.principal!.userId, request.params.id, request.body)
  );
  app.post(
    `${base}/:id/archive`,
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: empty,
        body: empty,
        description:
          "Idempotent archival preserves the account and atomically clears its selection as default. No delete/restore operation.",
        response: { ...errors, 200: accountSchema }
      }
    },
    (request) => service.archive(request.principal!.userId, request.params.id)
  );
}
