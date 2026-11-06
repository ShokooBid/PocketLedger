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
    "/v1/preferences",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        querystring: empty,
        description:
          "Permanent owner-scoped currency, null until explicitly chosen, plus derived active-account readiness. Reading never selects a currency.",
        response: { ...errors, 200: preferencesSchema }
      }
    },
    (request) => service.get(request.principal!.userId)
  );
  app.patch(
    "/v1/preferences",
    {
      onRequest: app.authenticate,
      schema: {
        ...secured,
        querystring: empty,
        body: preferencesPatch,
        description:
          "Choose currency once or update the optional default account. Repeating the chosen currency succeeds; changing it returns CURRENCY_LOCKED. Defaults must be owned, active and match the permanent currency.",
        response: { ...errors, 200: preferencesSchema }
      }
    },
    (request) => service.update(request.principal!.userId, request.body)
  );
}
