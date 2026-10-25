import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { errorSchema } from "../auth/routes.js";
import { categoryInput, categoryQuery, categorySchema } from "./contracts.js";
import type { CategoryService } from "./service.js";

export function registerCategoryRoutes(
  instance: FastifyInstance,
  categories: CategoryService
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 415, 422, 429, 500].map((code) => [
      code,
      errorSchema
    ])
  );
  const secured = { tags: ["Categories"], security: [{ bearerAuth: [] }] };
  const params = z.strictObject({ id: z.uuid() });
  app.get(
    "/v1/categories",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Owner-only list. Defaults to active; status=all includes historical categories. UUID keyset pagination; limit 1–100, default 50; after is the previous nextCursor.",
        querystring: categoryQuery,
        response: {
          ...errors,
          200: z.object({
            items: z.array(categorySchema),
            nextCursor: z.uuid().nullable()
          })
        }
      }
    },
    async (request) => categories.list(request.principal!.userId, request.query)
  );
  app.get(
    "/v1/categories/:id",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Owner-only lookup, including archived categories for history. Missing and foreign IDs both return 404.",
        params,
        querystring: z.strictObject({}),
        response: { ...errors, 200: categorySchema }
      }
    },
    async (request) =>
      categories.get(request.principal!.userId, request.params.id)
  );
  app.post(
    "/v1/categories",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Collapse/trim ASCII whitespace; preserve display case. Active duplicates ignore ASCII letter case within one owner (409). Non-ASCII letters are case-sensitive. Names are 1–100 UTF-16 units after normalization, visible, and contain no control/format/surrogate characters. Raw input is bounded at 1000 units.",
        body: categoryInput,
        querystring: z.strictObject({}),
        response: { ...errors, 201: categorySchema }
      }
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await categories.create(request.principal!.userId, request.body.name)
        )
  );
  app.patch(
    "/v1/categories/:id",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Rename an active owned category using create's normalization rule. Archived categories return 409.",
        params,
        body: categoryInput,
        querystring: z.strictObject({}),
        response: { ...errors, 200: categorySchema }
      }
    },
    async (request) =>
      categories.rename(
        request.principal!.userId,
        request.params.id,
        request.body.name
      )
  );
  app.post(
    "/v1/categories/:id/archive",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Archive after client confirmation. Idempotent; keeps historical references and frees the active name. No delete or restore operation.",
        params,
        body: z.strictObject({}),
        querystring: z.strictObject({}),
        response: { ...errors, 200: categorySchema }
      }
    },
    async (request) =>
      categories.archive(request.principal!.userId, request.params.id)
  );
}
