import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { errorSchema } from "../auth/routes.js";
import { preferencesPatch, preferencesSchema } from "./contracts.js";
import type { PreferencesService } from "./service.js";

export function registerPreferencesRoutes(
  instance: FastifyInstance,
  service: PreferencesService
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const empty = z.strictObject({});
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 415, 422, 429, 500].map((code) => [
      code,
      errorSchema
    ])
  );
  const secured = { tags: ["Preferences"], security: [{ bearerAuth: [] }] };
  app.get(
    "/v2/preferences",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        querystring: empty,
        description:
          "Owner-scoped persisted entry currency. CAD initially; locked by the first committed transaction. Gated off by default. Fresh test ledgers only; historical amounts are never relabelled.",
        response: { ...errors, 200: preferencesSchema }
      }
    },
    (request) => service.get(request.principal!.userId)
  );
  app.patch(
    "/v2/preferences",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        querystring: empty,
        body: preferencesPatch,
        description:
          "Set entry currency before the first saved transaction. Same-currency writes are idempotent; later changes return CURRENCY_LOCKED. Account preferences arrive with financial accounts.",
        response: { ...errors, 200: preferencesSchema }
      }
    },
    (request) =>
      service.update(request.principal!.userId, request.body.entryCurrency)
  );
}
