import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { errorSchema } from "../auth/routes.js";
import { historyPage, historyQuery } from "./contracts.js";
import type { HistoryService } from "./service.js";

export function registerHistoryRoutes(
  instance: FastifyInstance,
  service: HistoryService
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/v1/history",
    {
      onRequest: app.authenticate,
      schema: {
        tags: ["History"],
        security: [{ bearerAuth: [] }],
        description:
          "Owned logical history, one row per transfer. Inclusive date ranges at most 366 days apart; account/type/currency/exact-or-subtree category filters combine with AND. A category filter excludes transfers. Date/UUID/kind descending keyset pagination; after loads older rows and before loads nearer newer rows. A focusId/focusKind pair reveals an owned saved record with only necessary filter adjustments, with cursors in both directions. Daily counts and net totals cover all filtered records for the returned dates, grouped by account currency, independent of page boundaries; transfers count once and contribute zero to net. Rows and aggregates share a repeatable-read snapshot. Archived references remain visible. Unsafe totals return 422 SUMMARY_AMOUNT_OUT_OF_RANGE.",
        querystring: historyQuery,
        response: {
          200: historyPage,
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          422: errorSchema,
          429: errorSchema,
          500: errorSchema
        }
      }
    },
    (request) => service.list(request.principal!.userId, request.query)
  );
}
