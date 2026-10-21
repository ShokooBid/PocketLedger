import { z } from "zod";

const seconds = z.coerce.number().int().positive().max(31_536_000);
const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:/.test(value)),
  ACCESS_TOKEN_SECRET: z
    .string()
    .min(43)
    .refine((value) => {
      return (
        /^[A-Za-z0-9_-]+$/.test(value) &&
        Buffer.from(value, "base64url").length >= 32
      );
    }),
  ACCESS_TOKEN_ISSUER: z.string().min(1).default("pocketledger-api"),
  ACCESS_TOKEN_AUDIENCE: z.string().min(1).default("pocketledger-mobile"),
  ACCESS_TTL_SECONDS: seconds.default(900),
  SESSION_TTL_SECONDS: seconds.default(2_592_000),
  SESSION_IDLE_SECONDS: seconds.default(604_800),
  CHALLENGE_TTL_SECONDS: seconds.max(600).default(300),
  REAUTH_TTL_SECONDS: seconds.max(900).default(300),
  GOOGLE_CLIENT_IDS: z.string().default(""),
  GOOGLE_PRESENTER_IDS: z.string().default(""),
  CORS_ORIGINS: z.string().default("")
});

export function readConfig(environment: Record<string, string | undefined>) {
  const result = environmentSchema.safeParse(environment);
  // Never print Zod errors: they can contain environment values.
  if (!result.success)
    throw new Error(
      "Invalid API configuration. Check the environment template."
    );
  const value = result.data;
  const split = (input: string) =>
    input
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  const origins = split(value.CORS_ORIGINS);
  if (
    origins.some((origin) => {
      try {
        return (
          new URL(origin).origin !== origin ||
          (value.NODE_ENV === "production" && !origin.startsWith("https://"))
        );
      } catch {
        return true;
      }
    }) ||
    (value.NODE_ENV === "production" && origins.length === 0)
  ) {
    throw new Error(
      "Configure explicit allowed CORS origins (HTTPS in production)."
    );
  }
  return {
    environment: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    tokenKey: new Uint8Array(
      Buffer.from(value.ACCESS_TOKEN_SECRET, "base64url")
    ),
    issuer: value.ACCESS_TOKEN_ISSUER,
    audience: value.ACCESS_TOKEN_AUDIENCE,
    accessSeconds: value.ACCESS_TTL_SECONDS,
    sessionSeconds: value.SESSION_TTL_SECONDS,
    idleSeconds: value.SESSION_IDLE_SECONDS,
    challengeSeconds: value.CHALLENGE_TTL_SECONDS,
    reauthSeconds: value.REAUTH_TTL_SECONDS,
    googleAudiences: split(value.GOOGLE_CLIENT_IDS),
    googlePresenters: split(value.GOOGLE_PRESENTER_IDS),
    origins
  };
}

export type Config = ReturnType<typeof readConfig>;
