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

export async function buildApp(
  config: Config,
  auth: AuthService,
  options: {
    logger?: FastifyServerOptions["logger"];
    rateLimitMax?: number;
    categories?: CategoryService;
  } = {}
) {
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
              err: () => ({
                type: "InternalError",
                message: "Internal error",
                stack: ""
              })
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
    if (status >= 500)
      request.log.error({ requestId: request.id, code }, "request failed");
    return reply
      .code(status)
      .send({ error: { code, message, requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Resource not found.",
        requestId: request.id
      }
    })
  );
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.origins.includes(origin)) callback(null, true);
      else
        callback(
          new ApiError(403, "ORIGIN_DENIED", "Origin is not allowed."),
          false
        );
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
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
  return app;
}
