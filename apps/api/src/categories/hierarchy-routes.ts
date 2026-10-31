import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { errorSchema } from "../auth/routes.js";
import {
  hierarchyCategoryInput,
  hierarchyCategoryPatch,
  hierarchyCategoryQuery,
  hierarchyCategorySchema,
  recentCategoryQuery
} from "./contracts.js";
import type { HierarchyCategoryService } from "./hierarchy-service.js";

export function registerHierarchyCategoryRoutes(
  instance: FastifyInstance,
  service: HierarchyCategoryService
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 415, 422, 429, 500].map((code) => [
      code,
      errorSchema
    ])
  );
  const secured = { tags: ["Categories v2"], security: [{ bearerAuth: [] }] };
  const empty = z.strictObject({});
  const params = z.strictObject({ id: z.uuid() });
  // Read-only defaults report the domain conflict even for an attempted parent
  // change. Personal patches still reject parent/default fields in the schema.
  const protectDefault = async (request: FastifyRequest) => {
    const parsed = params.safeParse(request.params);
    if (parsed.success)
      await service.assertMutable(request.principal!.userId, parsed.data.id);
  };
  const base = "/v2/categories";
  app.get(
    base,
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Gated two-level owned categories. Flat UUID-keyset pages; parentId=root explicitly fetches roots, UUID fetches children. Omit to list all levels. Search matches category names; fetch parents by ID for paths. A page is not the full tree.",
        querystring: hierarchyCategoryQuery,
        response: {
          ...errors,
          200: z.object({
            items: z.array(hierarchyCategorySchema).max(100),
            nextCursor: z.uuid().nullable()
          })
        }
      }
    },
    (request) => service.list(request.principal!.userId, request.query)
  );
  app.get(
    `${base}/recent`,
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        querystring: recentCategoryQuery,
        response: {
          ...errors,
          200: z.object({
            items: z
              .array(
                hierarchyCategorySchema.extend({
                  parent: hierarchyCategorySchema.nullable()
                })
              )
              .max(20)
          })
        }
      }
    },
    (request) => service.recent(request.principal!.userId, request.query.limit)
  );
  app.get(
    `${base}/:id`,
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        params,
        querystring: empty,
        response: { ...errors, 200: hierarchyCategorySchema }
      }
    },
    (request) => service.get(request.principal!.userId, request.params.id)
  );
  app.post(
    base,
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        description:
          "Create a personal root or child of an active owned root. Active sibling names are unique under ASCII case folding. No catalog/default identity input.",
        body: hierarchyCategoryInput,
        querystring: empty,
        response: { ...errors, 201: hierarchyCategorySchema }
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
      preValidation: protectDefault,
      schema: {
        ...secured,
        description:
          "Nonempty name/presentation patch on an active personal category. Defaults are read only. Parent changes are unavailable, including unused categories.",
        params,
        body: hierarchyCategoryPatch,
        querystring: empty,
        response: { ...errors, 200: hierarchyCategorySchema }
      }
    },
    (request) =>
      service.update(request.principal!.userId, request.params.id, request.body)
  );
  app.post(
    `${base}/:id/archive`,
    {
      onRequest: app.authenticate,
      preValidation: protectDefault,
      schema: {
        ...secured,
        description:
          "Archive personal category and its active children atomically after client confirmation. Idempotent; preserves historical references. No restore or delete.",
        params,
        body: empty,
        querystring: empty,
        response: { ...errors, 200: hierarchyCategorySchema }
      }
    },
    (request) => service.archive(request.principal!.userId, request.params.id)
  );
}
