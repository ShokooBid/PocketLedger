import { randomUUID } from "node:crypto";
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyServerOptions
} from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider
} from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import type { AuthService } from "./auth/service.js";
import { errorSchema, registerAuthRoutes } from "./auth/routes.js";
import { registerCategoryRoutes } from "./categories/routes.js";
import type { CategoryService } from "./categories/service.js";
import type { TransactionService } from "./transactions/service.js";
import { registerTransactionRoutes } from "./transactions/routes.js";
import type { DashboardService } from "./dashboard/service.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import { registerPreferencesRoutes } from "./preferences/routes.js";
import type { PreferencesService } from "./preferences/service.js";
import type { AccountService } from "./accounts/service.js";
import { registerAccountRoutes } from "./accounts/routes.js";
import { registerTransferRoutes } from "./transfers/routes.js";
import type { TransferService } from "./transfers/service.js";
import type { HistoryService } from "./history/service.js";
import { registerHistoryRoutes } from "./history/routes.js";

export async function buildApp(
  config: Config,
  auth: AuthService,
  options: {
    logger?: FastifyServerOptions["logger"];
    rateLimitMax?: number;
    categories?: CategoryService;
    transactions?: TransactionService;
    dashboard?: DashboardService;
    preferences?: PreferencesService;
    accounts?: AccountService;
    transfers?: TransferService;
    history?: HistoryService;
  } = {}
) {
  const development = config.environment === "development";
  // Keep error diagnostics local to development. Never serialize arbitrary error
  // properties: database adapters can attach queries, parameters or credentials.
  function serializeError(
    error: unknown,
    depth = 0
  ): { type: string; message: string; stack: string; [key: string]: unknown } {
    if (!development)
      return { type: "InternalError", message: "Internal error", stack: "" };
    if (!(error instanceof Error))
      return { type: "UnknownError", message: "Non-Error failure", stack: "" };
    return {
      type: error.name,
      message: error.message,
      stack: error.stack ?? "",
      ...("code" in error && typeof error.code === "string"
        ? { code: error.code }
        : {}),
      ...(depth < 2 && error.cause instanceof Error
        ? { cause: serializeError(error.cause, depth + 1) }
        : {})
    };
  }
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: "info",
            ...(typeof options.logger === "object" ? options.logger : {}),
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "password",
              "accessToken",
              "refreshToken",
              "idToken",
              "nonce"
            ],
            serializers: {
              req: (request) => ({ method: request.method }),
              err: (error) => serializeError(error)
            }
          },
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 32768,
    trustProxy: false
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("cache-control", "no-store");
  });
  app.addHook("onResponse", async (request, reply) => {
    // Allowlist fields. No URL/query, bodies, headers, emails or raw errors.
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        statusCode: reply.statusCode
      },
      "request completed"
    );
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "An unexpected error occurred.";
    if (error instanceof ApiError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error.validation) {
      status = 422;
      code = "VALIDATION_ERROR";
      message = "One or more fields are invalid.";
    } else if (
      error.statusCode &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      status = error.statusCode;
      code = status === 429 ? "RATE_LIMITED" : "BAD_REQUEST";
      message =
        status === 429
          ? "Too many attempts. Try again later."
          : "The request could not be processed.";
    }
    const diagnostic = {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url,
      statusCode: status,
      code,
      ...(development
        ? {
            err: error,
            ...(error.validation
              ? {
                  validation: error.validation.map((issue) => ({
                    field: issue.instancePath,
                    message: issue.message
                  }))
                }
              : {})
          }
        : {})
    };
    if (status >= 500) request.log.error(diagnostic, "request failed");
    else if (development) request.log.warn(diagnostic, "request rejected");
    return reply
      .code(status)
      .send({ error: { code, message, requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) => {
    if (development)
      request.log.warn(
        {
          requestId: request.id,
          method: request.method,
          statusCode: 404,
          code: "NOT_FOUND"
        },
        "route not found"
      );
    return reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Resource not found.",
        requestId: request.id
      }
    });
  });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.origins.includes(origin)) callback(null, true);
      else
        callback(
          new ApiError(403, "ORIGIN_DENIED", "Origin is not allowed."),
          false
        );
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
    exposedHeaders: ["x-request-id"],
    credentials: false
  });
  await app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? 60,
    timeWindow: "1 minute",
    cache: 10000
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "PocketLedger API", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
        }
      }
    },
    transform: jsonSchemaTransform
  });
  app.withTypeProvider<ZodTypeProvider>().get(
    "/health",
    {
      schema: {
        response: {
          200: z.object({ status: z.literal("ok") }),
          429: errorSchema
        }
      }
    },
    async () => ({ status: "ok" as const })
  );
  registerAuthRoutes(app, auth);
  if (options.categories) registerCategoryRoutes(app, options.categories);
  if (options.transactions)
    registerTransactionRoutes(app, options.transactions);
  if (options.dashboard) registerDashboardRoutes(app, options.dashboard);
  if (options.preferences) registerPreferencesRoutes(app, options.preferences);
  if (options.accounts) registerAccountRoutes(app, options.accounts);
  if (options.transfers) registerTransferRoutes(app, options.transfers);
  if (options.history) registerHistoryRoutes(app, options.history);
  return app;
}
