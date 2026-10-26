import { describe, expect, it, jest } from "@jest/globals";
import { z } from "zod";
import {
  createTransport,
  failureMessage,
  ClientFailure,
  type FetchRequest
} from "../src/auth/transport";
import { createApiCategorySource } from "../src/category-api";
import { alice, harness, response, stored } from "./auth-fixtures";

const first = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";
const category = (id: string, archived = false) => ({
  id,
  name: "Synthetic category",
  isDefault: false,
  archivedAt: archived ? "2026-01-01T00:00:00Z" : null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
});

describe("sign-in methods", () => {
  it.each(["login", "register"] as const)(
    "validates %s before mounting real data",
    async (method) => {
      const h = harness(null);
      await h.controller.restore();
      h.fetcher
        .mockResolvedValueOnce(response(stored().credentials))
        .mockResolvedValueOnce(response(alice));
      await h.controller.signIn(
        method,
        "  ALICE@example.invalid ",
        "synthetic password"
      );
      expect(h.fetcher.mock.calls[0]?.[1]?.body).toBe(
        JSON.stringify({ email: alice.email, password: "synthetic password" })
      );
      expect(h.store.write).toHaveBeenCalledTimes(1);
      expect(h.controller.getSnapshot()).toMatchObject({
        status: "authenticated",
        user: alice
      });
    }
  );
  it("exchanges nonce-bound Google proof for PocketLedger credentials", async () => {
    const h = harness(null);
    await h.controller.restore();
    const nonce = "n".repeat(43);
    h.fetcher
      .mockResolvedValueOnce(
        response({
          challengeId: first,
          nonce,
          expiresAt: "2026-10-26T12:05:00Z"
        })
      )
      .mockResolvedValueOnce(response(stored().credentials))
      .mockResolvedValueOnce(response(alice));
    await h.controller.signIn("google");
    expect(h.proof).toHaveBeenCalledWith(nonce);
    expect(h.fetcher.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        challengeId: first,
        nonce,
        idToken: "synthetic-provider-proof"
      })
    );
    expect(h.fetcher.mock.calls[2]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer synthetic-access"
    });
    expect(JSON.stringify(h.disk())).not.toContain("synthetic-provider-proof");
  });
  it.each(["cancel", "failure"])(
    "keeps email sign-in usable after Google %s",
    async (outcome) => {
      const h = harness(null);
      await h.controller.restore();
      h.fetcher.mockResolvedValueOnce(
        response({
          challengeId: first,
          nonce: "n".repeat(43),
          expiresAt: "2026-10-26T12:05:00Z"
        })
      );
      if (outcome === "cancel") h.proof.mockResolvedValueOnce(null);
      else h.proof.mockRejectedValueOnce(new Error("private Google response"));
      await h.controller
        .signIn("google")
        .catch((error) =>
          expect(failureMessage(error)).not.toContain("private")
        );
      expect(h.controller.getSnapshot().status).toBe("signed-out");
      expect(h.store.write).not.toHaveBeenCalled();
      h.fetcher
        .mockResolvedValueOnce(response(stored().credentials))
        .mockResolvedValueOnce(response(alice));
      await h.controller.signIn("login", alice.email, "synthetic password");
      expect(h.controller.getSnapshot().status).toBe("authenticated");
    }
  );
});

describe("category API adapter", () => {
  it("traverses every bounded page including archived IDs", async () => {
    const h = harness();
    await h.controller.restore();
    h.fetcher
      .mockResolvedValueOnce(
        response({ items: [category(first)], nextCursor: first })
      )
      .mockResolvedValueOnce(
        response({ items: [category(second, true)], nextCursor: null })
      );
    const rows = await createApiCategorySource(h.client()).list();
    expect(rows.map((row) => row.id)).toEqual([first, second]);
    expect(rows[1]?.archivedAt).not.toBeNull();
    expect(h.fetcher.mock.calls[2]?.[0]).toContain(
      `status=all&limit=100&after=${first}`
    );
  });
  it("does not loop on a malformed/nonadvancing cursor", async () => {
    const h = harness();
    await h.controller.restore();
    h.fetcher.mockResolvedValue(
      response({ items: [category(first)], nextCursor: first })
    );
    await expect(
      createApiCategorySource(h.client()).list()
    ).rejects.toMatchObject({ kind: "protocol" });
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });
  it("sends writes to the protected contract and maps safe failures", async () => {
    const h = harness();
    await h.controller.restore();
    const source = createApiCategorySource(h.client());
    h.fetcher.mockResolvedValueOnce(response(category(first), 201));
    await source.create("Food");
    expect(h.fetcher.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "POST",
      body: '{"name":"Food"}',
      headers: { Authorization: "Bearer synthetic-access" }
    });
    h.fetcher.mockResolvedValueOnce(
      response(
        { error: { code: "CATEGORY_NAME_CONFLICT", message: "private" } },
        409
      )
    );
    await expect(source.rename(first, "FOOD")).rejects.toMatchObject({
      code: "duplicate"
    });
    h.fetcher.mockResolvedValueOnce(response({}, 404));
    await expect(source.archive(second)).rejects.toMatchObject({
      code: "unavailable"
    });
    h.fetcher.mockRejectedValueOnce(new Error("response lost"));
    const before = h.fetcher.mock.calls.length;
    await expect(source.create("Maybe saved")).rejects.toMatchObject({
      code: "uncertain"
    });
    expect(h.fetcher).toHaveBeenCalledTimes(before + 1);
  });
  it("refreshes a write once after a definitive 401 and never retries network failures", async () => {
    const h = harness();
    await h.controller.restore();
    h.fetcher
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(stored("new").credentials))
      .mockResolvedValueOnce(response(category(first), 201));
    await createApiCategorySource(h.client()).create("Food");
    expect(
      h.fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/categories")
      )
    ).toHaveLength(2);
  });
});

describe("transport boundaries", () => {
  it.each([
    undefined,
    "http://public.example.invalid",
    "https://user:secret@api.example.invalid",
    "https://api.example.invalid/path"
  ])("rejects unsafe API origin %s", async (url) => {
    const fetcher = jest.fn<FetchRequest>();
    await expect(
      createTransport(url, fetcher).send("GET", "/v1/me", z.unknown())
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("permits explicit local development HTTP and blocks redirects/cookies", async () => {
    const fetcher = jest.fn<FetchRequest>().mockResolvedValue(response({}));
    await createTransport("http://192.168.1.10:3000", fetcher, true).send(
      "GET",
      "/v1/me",
      z.unknown()
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      credentials: "omit"
    });
  });
  it("rejects malformed success payloads and never renders raw server/native diagnostics", async () => {
    const fetcher = jest
      .fn<FetchRequest>()
      .mockResolvedValueOnce(response({ accessToken: "private" }))
      .mockRejectedValueOnce(new Error("private"));
    const client = createTransport("https://api.example.invalid", fetcher);
    await expect(
      client.send("GET", "/v1/me", z.object({ id: z.uuid() }))
    ).rejects.toMatchObject({ kind: "protocol" });
    await expect(
      client.send("GET", "/v1/me", z.unknown())
    ).rejects.toMatchObject({ kind: "network", message: "network" });
    expect(failureMessage(new Error("private"))).not.toContain("private");
    expect(failureMessage(new ClientFailure("invalid"))).not.toContain(
      "private"
    );
  });
});
