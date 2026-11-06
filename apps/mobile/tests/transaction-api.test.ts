import { describe, expect, it, jest } from "@jest/globals";
import { z } from "zod";
import { createTransport, type FetchRequest } from "../src/auth/transport";
import { createApiTransactionSource } from "../src/transaction-api";
import { transactionCreate, transactionPatch } from "../src/transaction-data";
import { response } from "./auth-fixtures";

const id = "10000000-0000-4000-8000-000000000001";
const input = {
  clientRequestId: id,
  accountId: id,
  categoryId: id,
  direction: "expense" as const,
  amountMinor: 1250,
  date: "2026-11-03",
  note: null
};
describe("canonical bridge transport and adapter", () => {
  it("allows bounded canonical resource paths without weakening origin/redirect/path restrictions", async () => {
    const fetcher = jest
      .fn<FetchRequest>()
      .mockResolvedValue(response({ ok: true }));
    const client = createTransport("https://api.example.invalid", fetcher);
    for (const path of [
      "/v1/transactions",
      `/v1/transactions/${id}`,
      `/v1/accounts/${id}?asOf=2026-11-03`
    ])
      await client.send(
        "GET",
        path,
        z.object({ ok: z.boolean() }),
        undefined,
        "synthetic-token"
      );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
      headers: { Authorization: "Bearer synthetic-token" }
    });
    for (const path of [
      "https://evil.invalid/v1/transactions",
      "//evil.invalid/v1/transactions",
      "/v1/../transactions",
      "/v3/transactions",
      "/v1/imports",
      "/v1/transactions#fragment"
    ])
      await expect(client.send("GET", path, z.unknown())).rejects.toMatchObject(
        { kind: "configuration" }
      );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    "INVALID_ACCOUNT",
    "PREFERENCE_CHANGED",
    "IDEMPOTENCY_KEY_REUSED",
    "OPERATION_ALREADY_APPLIED"
  ])(
    "preserves safe %s codes without exposing server messages",
    async (code) => {
      const fetcher = jest
        .fn<FetchRequest>()
        .mockResolvedValue(
          response({ error: { code, message: "private server text" } }, 409)
        );
      await expect(
        createTransport("https://api.example.invalid", fetcher).send(
          "POST",
          "/v1/transactions",
          z.unknown(),
          input
        )
      ).rejects.toMatchObject({ kind: "conflict", code });
    }
  );
  it("does not retry an uncertain write or replace its caller-owned creation identity", async () => {
    const fetcher = jest
      .fn<FetchRequest>()
      .mockRejectedValue(new Error("private network data"));
    const api = createApiTransactionSource(
      createTransport("https://api.example.invalid", fetcher)
    );
    await expect(api.create(input)).rejects.toMatchObject({ kind: "network" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1].body))).toEqual(input);
    expect(
      transactionCreate.safeParse({ ...input, merchant: "forged" }).success
    ).toBe(false);
    expect(
      transactionCreate.safeParse({ ...input, currency: "CAD" }).success
    ).toBe(false);
    expect(transactionPatch.safeParse({ currency: "CAD" }).success).toBe(false);
  });
  it("sends currency-free writes while requiring derived currency on responses", async () => {
    const saved = {
      ...input,
      id,
      currency: "CAD",
      importId: null,
      createdAt: "2026-11-03T00:00:00Z",
      updatedAt: "2026-11-03T00:00:00Z"
    };
    const { clientRequestId: _key, ...resource } = saved;
    expect(_key).toBe(id);
    const fetcher = jest
      .fn<FetchRequest>()
      .mockResolvedValue(response(resource));
    const api = createApiTransactionSource(
      createTransport("https://api.example.invalid", fetcher)
    );
    expect((await api.create(input)).currency).toBe("CAD");
    expect((await api.update(id, { amountMinor: 1234 })).currency).toBe("CAD");
    expect(
      JSON.parse(String(fetcher.mock.calls[0]?.[1].body))
    ).not.toHaveProperty("currency");
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1].body))).toEqual({
      amountMinor: 1234
    });
    const { currency: _currency, ...invalid } = resource;
    expect(_currency).toBe("CAD");
    fetcher.mockResolvedValueOnce(response(invalid));
    await expect(api.get(id)).rejects.toMatchObject({ kind: "protocol" });
  });
});
