import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AuthService } from "../src/auth/service.js";
import { invalidCredentials } from "../src/errors.js";
import { readConfig } from "../src/config.js";
import { testConfig } from "./fixtures.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup(
  auth = {} as AuthService,
  options: Parameters<typeof buildApp>[2] = { logger: false }
) {
  const app = await buildApp(testConfig(), auth, options);
  apps.push(app);
  return app;
}

describe("Fastify foundation", () => {
  it("serves safe health, fresh server-generated request IDs and no-store", async () => {
    const app = await setup();
    const response = await app.inject({
      url: "/health",
      headers: { "x-request-id": "untrusted" }
    });
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).not.toBe("untrusted");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect((await app.inject("/health")).headers["x-request-id"]).not.toBe(
      response.headers["x-request-id"]
    );
  });
  it("rejects weak passwords, extra fields and malformed JSON without echoing values", async () => {
    const app = await setup();
    for (const payload of [
      { email: "synthetic@example.invalid", password: "short" },
      {
        email: "synthetic@example.invalid",
        password: "long synthetic password",
        userId: "injected"
      }
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload
      });
      expect(response.statusCode).toBe(422);
      expect(response.body).not.toContain("synthetic@example.invalid");
    }
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: '{"password":"sensitive"'
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain("sensitive");
  });
  it("maps missing auth, unknown routes and unhandled errors into safe envelopes", async () => {
    const app = await setup({
      login: async () => {
        throw new Error("SQL secret synthetic-password");
      }
    } as unknown as AuthService);
    expect((await app.inject("/v1/me")).statusCode).toBe(401);
    const unknown = await app.inject("/missing?secret=synthetic-password");
    expect(unknown.statusCode).toBe(404);
    const failure = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "synthetic@example.invalid",
        password: "synthetic-password"
      }
    });
    expect(failure.statusCode).toBe(500);
    expect(failure.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: failure.headers["x-request-id"]
      }
    });
    expect(failure.body).not.toMatch(/SQL|stack|synthetic-password/);
  });
  it("enforces an exact CORS allowlist and preflight", async () => {
    const app = await setup();
    expect(
      (
        await app.inject({
          url: "/health",
          headers: { origin: "https://evil.example.invalid" }
        })
      ).statusCode
    ).toBe(403);
    const allowed = await app.inject({
      method: "OPTIONS",
      url: "/v1/auth/login",
      headers: {
        origin: "https://app.example.invalid",
        "access-control-request-method": "POST"
      }
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://app.example.invalid"
    );
  });
  it("rate limits IPs and normalized accounts", async () => {
    const login = vi.fn(async () => {
      throw invalidCredentials();
    });
    const app = await setup({ login } as unknown as AuthService);
    for (let i = 0; i < 11; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        remoteAddress: `127.0.0.${i + 1}`,
        payload: {
          email:
            i % 2 ? " Synthetic@Example.invalid " : "synthetic@example.invalid",
          password: "incorrect"
        }
      });
      expect(response.statusCode).toBe(i < 10 ? 401 : 429);
    }
    expect(login).toHaveBeenCalledTimes(10);
    const limited = await setup({} as AuthService, {
      logger: false,
      rateLimitMax: 1
    });
    await limited.inject("/health");
    const response = await limited.inject("/health");
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe("RATE_LIMITED");
  });
  it("generates OpenAPI from implemented Zod route contracts", async () => {
    const app = await setup();
    await app.ready();
    const paths = app.swagger().paths!;
    expect(Object.keys(paths)).toHaveLength(10);
    expect(paths["/v1/auth/register"]?.post).toHaveProperty("requestBody");
    expect(paths["/v1/me"]?.get?.security).toEqual([{ bearerAuth: [] }]);
  });
  it("logs no raw request, token, provider or database error values", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      }
    });
    const app = await setup(
      {
        login: async () => {
          throw new Error("synthetic-database-secret");
        }
      } as unknown as AuthService,
      { logger: { level: "info", stream } }
    );
    await app.inject({
      method: "POST",
      url: "/v1/auth/login?token=synthetic-query-secret",
      headers: {
        authorization: "Bearer synthetic-bearer-secret",
        cookie: "synthetic-cookie-secret"
      },
      payload: {
        email: "synthetic-private@example.invalid",
        password: "synthetic-password-secret"
      }
    });
    expect(lines.join("")).not.toMatch(/synthetic-/);
    expect(lines.join("")).toContain("request completed");
  });
  it("validates configuration without echoing secrets", () => {
    expect(() =>
      readConfig({ ACCESS_TOKEN_SECRET: "synthetic-secret" })
    ).toThrow("Invalid API configuration");
    const env = {
      DATABASE_URL: "postgresql://unused:unused@localhost/unused",
      ACCESS_TOKEN_SECRET: "A".repeat(43),
      NODE_ENV: "production"
    };
    expect(() => readConfig(env)).toThrow("CORS");
    expect(() => readConfig({ ...env, CORS_ORIGINS: "*" })).toThrow("CORS");
    expect(
      readConfig({ ...env, CORS_ORIGINS: "https://app.example.invalid" })
        .accessSeconds
    ).toBe(900);
  });
});
