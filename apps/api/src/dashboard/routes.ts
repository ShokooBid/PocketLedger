import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { errorSchema } from "../auth/routes.js";
import { summaryQuery, summarySchema } from "./contracts.js";
import type { DashboardService } from "./service.js";

export function registerDashboardRoutes(
  instance: FastifyInstance,
  service: DashboardService
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/v1/dashboard/summary",
    {
      onRequest: app.authenticate,
      schema: {
        tags: ["Dashboard"],
        security: [{ bearerAuth: [] }],
        description:
          "Owned summary for required inclusive from/to calendar dates (0001–9999), at most 366 days apart, and one required supported currency; no currency conversion. Dates use the user's intended accounting calendar, without server timezone or DST conversion; audit timestamps do not select the period. Income/expenses are nonnegative integer minor units; net is income minus expenses. Totals cover every matching transaction, independent of recentLimit (1–20, default 5). Recent transactions use the same period/currency, date descending then UUID descending. Category breakdown includes archived categories with current names, ordered by category UUID ascending. Empty periods return zero totals and empty arrays. Reads share one database snapshot. Amounts beyond JavaScript's safe integer range return 422 SUMMARY_AMOUNT_OUT_OF_RANGE, never rounded values.",
        querystring: summaryQuery,
        response: {
          200: summarySchema,
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          422: errorSchema,
          429: errorSchema,
          500: errorSchema
        }
      }
    },
    async (request) => service.summary(request.principal!.userId, request.query)
  );
}
