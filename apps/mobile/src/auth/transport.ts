import type { z } from "zod";

export type FailureKind =
  | "network"
  | "server"
  | "invalid"
  | "validation"
  | "conflict"
  | "unavailable"
  | "rate-limit"
  | "protocol"
  | "configuration"
  | "storage"
  | "ambiguous"
  | "cancelled"
  | "provider";

// Only fixed, allowlisted identifiers reach UI/errors. Never attach responses,
// request bodies, native exceptions, URLs or credentials to an exception.
export class ClientFailure extends Error {
  constructor(
    public readonly kind: FailureKind,
    public readonly code = ""
  ) {
    super(kind);
  }
}
export function failureMessage(error: unknown): string {
  const kind = error instanceof ClientFailure ? error.kind : "server";
  const messages: Record<FailureKind, string> = {
    network: "Cannot reach PocketLedger. Check your connection and try again.",
    server: "PocketLedger is temporarily unavailable. Try again later.",
    invalid: "Sign-in could not be verified. Please sign in again.",
    validation:
      "Check your email and password. New passwords need 12–128 characters.",
    conflict:
      "Use your existing sign-in method. Accounts are not linked automatically.",
    unavailable: "This item is unavailable. Reload the list.",
    "rate-limit": "Too many attempts. Please wait before trying again.",
    protocol:
      "PocketLedger returned an unexpected response. Please try again later.",
    configuration:
      "Sign-in is unavailable in this build. You can still explore the demo.",
    storage: "Secure storage is unavailable. Retry before continuing.",
    ambiguous:
      "Session renewal could not be confirmed. Sign in again to continue safely.",
    cancelled: "Sign-in was cancelled.",
    provider:
      "Google sign-in is unavailable. Try again or use email and password."
  };
  return messages[kind];
}

export interface Transport {
  send<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    accessToken?: string
  ): Promise<T>;
}
// Only this subset of fetch is used. Keep native/DOM/Node overloads out of the
// injectable boundary so the same client can be verified against the real API.
export type FetchRequest = (
  url: string,
  options: RequestInit
) => Promise<Response>;

export function createTransport(
  baseUrl: string | undefined,
  fetcher: FetchRequest = fetch,
  allowLocalHttp = false
): Transport {
  let origin: string | undefined;
  try {
    const url = new URL(baseUrl ?? "");
    const local =
      /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
        url.hostname
      );
    if (
      (url.protocol === "https:" ||
        (allowLocalHttp && local && url.protocol === "http:")) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      origin = url.origin;
  } catch {
    /* Missing configuration leaves the demo available. */
  }
  return {
    async send(method, path, schema, body, accessToken) {
      if (
        !origin ||
        !(
          /^\/v1\/[A-Za-z0-9/?=&_.%-]+$/.test(path) ||
          path === "/v2/preferences"
        ) ||
        path.includes("..")
      )
        throw new ClientFailure("configuration");
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 15000);
      try {
        const response = await fetcher(`${origin}${path}`, {
          method,
          redirect: "error",
          credentials: "omit",
          signal: abort.signal,
          headers: {
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        if (!response.ok) {
          // Status is authoritative for invalid sessions, even with a malformed body.
          if (response.status === 401) throw new ClientFailure("invalid");
          if (response.status === 429) throw new ClientFailure("rate-limit");
          if (response.status >= 500) throw new ClientFailure("server");
          if (response.status === 404 || response.status === 403)
            throw new ClientFailure("unavailable");
          let code = "";
          try {
            const data: unknown = await response.json();
            if (
              typeof data === "object" &&
              data !== null &&
              "error" in data &&
              typeof data.error === "object" &&
              data.error !== null &&
              "code" in data.error &&
              (data.error.code === "CATEGORY_NAME_CONFLICT" ||
                data.error.code === "CATEGORY_ARCHIVED" ||
                data.error.code === "CURRENCY_LOCKED" ||
                data.error.code === "CURRENCY_MISMATCH" ||
                data.error.code === "CURRENCY_IMMUTABLE" ||
                data.error.code === "CURRENCY_SETUP_REQUIRED" ||
                data.error.code === "FINANCE_FEATURE_DISABLED")
            )
              code = data.error.code;
          } catch {
            /* No raw server errors leave the transport. */
          }
          throw new ClientFailure(
            response.status === 409 ? "conflict" : "validation",
            code
          );
        }
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new ClientFailure("protocol");
        }
        const parsed = schema.safeParse(data);
        if (!parsed.success) throw new ClientFailure("protocol");
        return parsed.data;
      } catch (error) {
        throw error instanceof ClientFailure
          ? error
          : new ClientFailure("network");
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
