import { describe, expect, it } from "@jest/globals";
import { z } from "zod";
import { userSchema } from "../src/auth/contracts";
import { createSessionController } from "../src/auth/session-controller";
import {
  alice,
  bob,
  deferred,
  harness,
  now,
  response,
  stored
} from "./auth-fixtures";

describe("verified mobile sessions", () => {
  it("keeps navigation pending until the stored session is verified", async () => {
    const h = harness();
    const pending = deferred<Response>();
    h.fetcher.mockReturnValueOnce(pending.promise);
    const restore = h.controller.restore();
    expect(h.controller.getSnapshot()).toEqual({ status: "restoring" });
    pending.resolve(response(alice));
    await restore;
    expect(h.controller.getSnapshot()).toMatchObject({
      status: "authenticated",
      user: alice
    });
    expect(h.store.clear).not.toHaveBeenCalled();
  });
  it("returns to sign-in for missing and expired absolute credentials", async () => {
    for (const value of [
      null,
      {
        ...stored(),
        credentials: {
          ...stored().credentials,
          sessionExpiresAt: new Date(now - 1).toISOString()
        }
      }
    ]) {
      const h = harness(value);
      await h.controller.restore();
      expect(h.controller.getSnapshot().status).toBe("signed-out");
      expect(h.fetcher).not.toHaveBeenCalled();
    }
  });
  it("refreshes expired access and securely persists the replacement before navigation", async () => {
    const h = harness(stored("old", true));
    h.fetcher.mockResolvedValueOnce(response(stored("new").credentials));
    await h.controller.restore();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(
      h.store.write.mock.calls.map(([value]) => value.refreshPending)
    ).toEqual([true, false]);
    expect(h.disk()?.credentials.accessToken).toBe("new");
    expect(h.controller.getSnapshot().status).toBe("authenticated");
  });
  it("shares one refresh for simultaneous and late 401s and retries each request once", async () => {
    const h = harness();
    await h.controller.restore();
    h.fetcher.mockClear();
    const late = deferred<Response>();
    let oldCalls = 0;
    h.fetcher.mockImplementation(async (url, options) => {
      if (String(url).endsWith("/refresh"))
        return response(stored("new").credentials);
      if (
        (options?.headers as Record<string, string>).Authorization ===
        "Bearer synthetic-access"
      ) {
        if (++oldCalls === 3) return late.promise;
        return response({}, 401);
      }
      return response(alice);
    });
    const client = h.client();
    const one = client.send("GET", "/v1/me", userSchema);
    const two = client.send("GET", "/v1/me", userSchema);
    const three = client.send("GET", "/v1/me", userSchema);
    await Promise.all([one, two]);
    late.resolve(response({}, 401));
    await three;
    expect(
      h.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/refresh"))
    ).toHaveLength(1);
    expect(h.fetcher).toHaveBeenCalledTimes(7);
  });
  it("clears definitively revoked refresh credentials and rejects old clients", async () => {
    const h = harness();
    await h.controller.restore();
    const client = h.client();
    h.fetcher.mockResolvedValue(response({}, 401));
    await expect(
      client.send("GET", "/v1/me", userSchema)
    ).rejects.toBeDefined();
    expect(h.controller.getSnapshot().status).toBe("signed-out");
    expect(h.disk()).toBeNull();
    const calls = h.fetcher.mock.calls.length;
    await expect(
      client.send("GET", "/v1/me", userSchema)
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(h.fetcher).toHaveBeenCalledTimes(calls);
  });
  it("never retries a second 401 or refreshes twice after proactive renewal", async () => {
    for (const expired of [false, true]) {
      const h = harness(stored("old", expired));
      let refreshes = 0;
      h.fetcher.mockImplementation(async (url) => {
        if (String(url).endsWith("/refresh")) {
          ++refreshes;
          return response(stored("new").credentials);
        }
        return response({}, 401);
      });
      await h.controller.restore();
      expect(h.controller.getSnapshot().status).toBe("signed-out");
      expect(refreshes).toBe(1);
      expect(
        h.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/me"))
      ).toHaveLength(expired ? 1 : 2);
    }
  });
  it("preserves credentials for transient restore failures and permits a read retry", async () => {
    const h = harness();
    h.fetcher.mockRejectedValueOnce(new Error("private network diagnostic"));
    await h.controller.restore();
    expect(h.controller.getSnapshot()).toEqual({
      status: "unavailable",
      reason: "network"
    });
    expect(h.disk()).toEqual(stored());
    await h.controller.restore();
    expect(h.controller.getSnapshot().status).toBe("authenticated");
  });
  it("preserves an ambiguous rotation marker across restart without replay", async () => {
    const h = harness(stored("old", true));
    h.fetcher.mockRejectedValueOnce(new Error("lost response"));
    await h.controller.restore();
    expect(h.disk()?.refreshPending).toBe(true);
    const restarted = createSessionController(
      h.store,
      h.transport,
      h.proof,
      () => now
    );
    await restarted.restore();
    expect(restarted.getSnapshot()).toEqual({
      status: "unavailable",
      reason: "ambiguous"
    });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.store.clear).not.toHaveBeenCalled();
  });
  it("can retry renewal rejected by the server's pre-handler rate limiter", async () => {
    const h = harness(stored("old", true));
    h.fetcher.mockResolvedValueOnce(response({}, 429));
    await h.controller.restore();
    expect(h.disk()?.refreshPending).toBe(false);
    h.fetcher.mockResolvedValueOnce(response(stored("new").credentials));
    await h.controller.restore();
    expect(h.controller.getSnapshot().status).toBe("authenticated");
  });
  it("does not send a refresh if the durable pending marker cannot be saved", async () => {
    const h = harness(stored("old", true));
    h.store.write.mockRejectedValueOnce(new Error("locked secure store"));
    await h.controller.restore();
    expect(h.controller.getSnapshot()).toEqual({
      status: "unavailable",
      reason: "storage"
    });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("revokes on logout and clears credentials, even offline", async () => {
    for (const offline of [false, true]) {
      const h = harness();
      await h.controller.restore();
      if (offline) h.fetcher.mockRejectedValueOnce(new Error("offline"));
      else h.fetcher.mockResolvedValueOnce(response({ ok: true }));
      await h.controller.logout();
      expect(h.disk()).toBeNull();
      expect(h.fetcher.mock.calls.at(-1)?.[0]).toBe(
        "https://api.example.invalid/v1/auth/logout"
      );
      expect(h.controller.getSnapshot()).toMatchObject({
        status: "signed-out",
        notice: expect.stringContaining(
          offline ? "could not be confirmed" : "Signed out."
        )
      });
    }
  });
  it("discards stale responses after logout and account switch", async () => {
    const h = harness();
    await h.controller.restore();
    const oldClient = h.client();
    const pending = deferred<Response>();
    h.fetcher
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response({ ok: true }));
    const result = oldClient.send("GET", "/v1/me", userSchema);
    const rejected = expect(result).rejects.toMatchObject({
      kind: "cancelled"
    });
    await h.controller.logout();
    h.fetcher
      .mockResolvedValueOnce(response(stored("bob").credentials))
      .mockResolvedValueOnce(response(bob));
    await h.controller.signIn("login", bob.email, "synthetic password");
    pending.resolve(response(alice));
    await rejected;
    expect(h.controller.getSnapshot()).toMatchObject({
      status: "authenticated",
      user: bob
    });
    await expect(
      oldClient.send("POST", "/v1/categories", z.unknown(), {
        name: "old write"
      })
    ).rejects.toMatchObject({ kind: "cancelled" });
  });
  it("does not restore credentials after local logout failed to delete them", async () => {
    const h = harness();
    await h.controller.restore();
    h.store.clear.mockRejectedValueOnce(new Error("locked"));
    await h.controller.logout();
    await h.controller.restore();
    expect(h.controller.getSnapshot()).toEqual({
      status: "unavailable",
      reason: "storage"
    });
    expect(h.store.read).toHaveBeenCalledTimes(1);
    await h.controller.logout();
    expect(h.disk()).toBeNull();
  });

  it("cannot restore credentials from a refresh that finishes after logout", async () => {
    const h = harness();
    await h.controller.restore();
    const pending = deferred<Response>();
    const started = deferred<void>();
    h.fetcher
      .mockResolvedValueOnce(response({}, 401))
      .mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      });
    const request = h.client().send("GET", "/v1/me", userSchema);
    const cancelled = expect(request).rejects.toMatchObject({
      kind: "cancelled"
    });
    await started.promise;
    h.fetcher.mockResolvedValueOnce(response({ ok: true }));
    await h.controller.logout();
    pending.resolve(response(stored("late replacement").credentials));
    await cancelled;
    expect(h.disk()).toBeNull();
    expect(h.controller.getSnapshot().status).toBe("signed-out");
    expect(h.store.write.mock.calls).toHaveLength(1); // Pending marker only.
  });

  it("retains the pending marker if a rotated credential cannot be stored", async () => {
    const h = harness(stored("old", true));
    const persist = h.store.write.getMockImplementation()!;
    h.store.write
      .mockImplementationOnce(persist)
      .mockRejectedValueOnce(new Error("device locked"));
    h.fetcher.mockResolvedValueOnce(response(stored("new").credentials));
    await h.controller.restore();
    expect(h.controller.getSnapshot()).toEqual({
      status: "unavailable",
      reason: "storage"
    });
    expect(h.disk()?.refreshPending).toBe(true);
    expect(h.store.clear).not.toHaveBeenCalled();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
});
