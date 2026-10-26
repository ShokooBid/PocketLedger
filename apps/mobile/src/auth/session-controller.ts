import type { z } from "zod";
import {
  challengeSchema,
  credentialsSchema,
  okSchema,
  userSchema,
  type CredentialStore,
  type GoogleProof,
  type StoredSession,
  type User
} from "./contracts";
import { ClientFailure, type FailureKind, type Transport } from "./transport";

export type SessionState =
  | { status: "restoring" | "signing-out" }
  | { status: "signed-out"; notice?: string }
  | { status: "unavailable"; reason: FailureKind }
  | { status: "demo" }
  | { status: "authenticated"; user: User; generation: number };

export function createSessionController(
  store: CredentialStore,
  transport: Transport,
  googleProof: GoogleProof,
  now: () => number = Date.now
) {
  let state: SessionState = { status: "restoring" };
  let saved: StoredSession | null = null;
  let epoch = 0;
  let refreshFlight: Promise<void> | undefined;
  let authFlight: Promise<void> | undefined;
  let clearRequired = false;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (value: SessionState) => {
    state = value;
    listeners.forEach((fn) => fn());
  };
  const current = (generation: number) => {
    if (generation !== epoch) throw new ClientFailure("cancelled");
  };
  const write = (value: StoredSession | null) => {
    const next = writes.then(() =>
      value ? store.write(value) : store.clear()
    );
    writes = next.catch(() => {});
    return next.catch(() => {
      throw new ClientFailure("storage");
    });
  };
  async function invalidate(generation: number) {
    current(generation);
    const clearingEpoch = ++epoch;
    refreshFlight = undefined;
    saved = null;
    clearRequired = true;
    publish({ status: "signing-out" });
    try {
      await write(null);
      current(clearingEpoch);
      clearRequired = false;
      publish({
        status: "signed-out",
        notice: "Your session ended. Please sign in again."
      });
    } catch {
      if (clearingEpoch === epoch)
        publish({ status: "unavailable", reason: "storage" });
      throw new ClientFailure("storage");
    }
  }
  async function refresh(generation: number) {
    current(generation);
    if (refreshFlight) return refreshFlight;
    if (!saved) throw new ClientFailure("invalid");
    if (saved.refreshPending) throw new ClientFailure("ambiguous");
    if (Date.parse(saved.credentials.sessionExpiresAt) <= now()) {
      await invalidate(generation);
      throw new ClientFailure("invalid");
    }
    const pending = { ...saved, refreshPending: true };
    saved = pending;
    const work = async () => {
      // Durable before dispatch: after a crash we cannot know whether rotation
      // committed. Never silently send the consumed token a second time.
      await write(pending);
      current(generation);
      try {
        const credentials = await transport.send(
          "POST",
          "/v1/auth/refresh",
          credentialsSchema,
          { refreshToken: pending.credentials.refreshToken }
        );
        current(generation);
        const replacement: StoredSession = {
          version: 1,
          credentials,
          refreshPending: false
        };
        await write(replacement);
        current(generation);
        saved = replacement;
      } catch (error) {
        current(generation);
        if (error instanceof ClientFailure && error.kind === "invalid") {
          await invalidate(generation);
        } else if (
          error instanceof ClientFailure &&
          error.kind === "rate-limit"
        ) {
          // The API's limiter rejects before the refresh handler consumes a token.
          saved = { ...pending, refreshPending: false };
          await write(saved);
        }
        throw error;
      }
    };
    const flight = work();
    refreshFlight = flight;
    try {
      await flight;
    } finally {
      if (refreshFlight === flight) refreshFlight = undefined;
    }
  }
  async function request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    generation = epoch
  ): Promise<T> {
    current(generation);
    if (!saved) throw new ClientFailure("invalid");
    try {
      const refreshed = Date.parse(saved.credentials.accessExpiresAt) <= now();
      if (refreshed) await refresh(generation);
      current(generation);
      const access = saved!.credentials.accessToken;
      try {
        const value = await transport.send(method, path, schema, body, access);
        current(generation);
        return value;
      } catch (error) {
        current(generation);
        if (!(error instanceof ClientFailure) || error.kind !== "invalid")
          throw error;
        // A late 401 for an old access token shares the completed rotation too.
        if (saved!.credentials.accessToken === access) {
          if (refreshed) {
            await invalidate(generation);
            throw error;
          }
          await refresh(generation);
        }
        current(generation);
        try {
          const value = await transport.send(
            method,
            path,
            schema,
            body,
            saved!.credentials.accessToken
          );
          current(generation);
          return value;
        } catch (retryError) {
          current(generation);
          if (
            retryError instanceof ClientFailure &&
            retryError.kind === "invalid"
          )
            await invalidate(generation);
          throw retryError;
        }
      }
    } catch (error) {
      if (generation === epoch && saved?.refreshPending)
        publish({
          status: "unavailable",
          reason:
            error instanceof ClientFailure && error.kind === "storage"
              ? "storage"
              : "ambiguous"
        });
      throw error;
    }
  }
  async function validate(generation: number) {
    const user = await request(
      "GET",
      "/v1/me",
      userSchema,
      undefined,
      generation
    );
    current(generation);
    publish({ status: "authenticated", user, generation });
  }
  function exclusive(work: () => Promise<void>) {
    if (authFlight) return authFlight;
    const flight = work();
    authFlight = flight;
    void flight
      .finally(() => {
        if (authFlight === flight) authFlight = undefined;
      })
      .catch(() => {});
    return flight;
  }
  const controller = {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    restore: () =>
      exclusive(async () => {
        if (clearRequired) {
          publish({ status: "unavailable", reason: "storage" });
          return;
        }
        const generation = ++epoch;
        refreshFlight = undefined;
        publish({ status: "restoring" });
        try {
          await writes;
          let restored: StoredSession | null;
          try {
            restored = await store.read();
          } catch {
            throw new ClientFailure("storage");
          }
          current(generation);
          saved = restored;
          if (!saved) {
            publish({ status: "signed-out" });
            return;
          }
          if (Date.parse(saved.credentials.sessionExpiresAt) <= now()) {
            await invalidate(generation);
            return;
          }
          if (saved.refreshPending) throw new ClientFailure("ambiguous");
          await validate(generation);
        } catch (error) {
          if (generation === epoch)
            publish({
              status: "unavailable",
              reason: error instanceof ClientFailure ? error.kind : "storage"
            });
        }
      }),
    signIn: (
      method: "login" | "register" | "google",
      email = "",
      password = ""
    ) =>
      exclusive(async () => {
        if (state.status !== "signed-out") throw new ClientFailure("invalid");
        const generation = ++epoch;
        try {
          let body: unknown = { email: email.trim().toLowerCase(), password };
          if (method === "google") {
            const challenge = await transport.send(
              "POST",
              "/v1/auth/google/challenges",
              challengeSchema,
              { purpose: "login" }
            );
            current(generation);
            const idToken = await googleProof(challenge.nonce);
            current(generation);
            if (!idToken) return;
            body = {
              challengeId: challenge.challengeId,
              nonce: challenge.nonce,
              idToken
            };
          }
          const credentials = await transport.send(
            "POST",
            `/v1/auth/${method}`,
            credentialsSchema,
            body
          );
          current(generation);
          const session: StoredSession = {
            version: 1,
            credentials,
            refreshPending: false
          };
          saved = session;
          await write(session);
          current(generation);
          await validate(generation);
        } catch (error) {
          if (generation === epoch && saved)
            publish({
              status: "unavailable",
              reason: error instanceof ClientFailure ? error.kind : "server"
            });
          throw error instanceof ClientFailure
            ? error
            : new ClientFailure("provider");
        }
      }),
    logout: () =>
      exclusive(async () => {
        const previous = saved;
        ++epoch; // All previously issued readers/adapters become unusable immediately.
        refreshFlight = undefined;
        saved = null;
        clearRequired = true;
        publish({ status: "signing-out" });
        try {
          await write(null);
        } catch {
          publish({ status: "unavailable", reason: "storage" });
          return;
        }
        clearRequired = false;
        let revoked = !previous;
        if (previous) {
          try {
            let access = previous.credentials.accessToken;
            try {
              await transport.send(
                "POST",
                "/v1/auth/logout",
                okSchema,
                {},
                access
              );
            } catch (error) {
              if (
                !(error instanceof ClientFailure) ||
                error.kind !== "invalid" ||
                previous.refreshPending
              )
                throw error;
              const replacement = await transport.send(
                "POST",
                "/v1/auth/refresh",
                credentialsSchema,
                { refreshToken: previous.credentials.refreshToken }
              );
              access = replacement.accessToken;
              await transport.send(
                "POST",
                "/v1/auth/logout",
                okSchema,
                {},
                access
              );
            }
            revoked = true;
          } catch {
            /* Local logout succeeds even when remote revocation cannot be confirmed. */
          }
        }
        publish({
          status: "signed-out",
          notice: revoked
            ? "Signed out."
            : "Signed out on this device. Server revocation could not be confirmed; the old session remains bounded by server expiry."
        });
      }),
    enterDemo() {
      if (state.status === "signed-out" && !authFlight) {
        ++epoch;
        publish({ status: "demo" });
      }
    },
    exitDemo() {
      if (state.status === "demo") {
        ++epoch;
        publish({ status: "signed-out" });
      }
    },
    client(generation: number): Transport {
      return {
        send: (method, path, schema, body) => {
          if (
            state.status !== "authenticated" ||
            state.generation !== generation
          )
            return Promise.reject(new ClientFailure("cancelled"));
          return request(method, path, schema, body, generation);
        }
      };
    }
  };
  return controller;
}
export type SessionController = ReturnType<typeof createSessionController>;
