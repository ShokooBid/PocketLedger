import { jest } from "@jest/globals";
import type { CredentialStore, StoredSession } from "../src/auth/contracts";
import { createSessionController } from "../src/auth/session-controller";
import { createTransport, type FetchRequest } from "../src/auth/transport";
import type { Currency } from "../src/transaction-data";
import type { AccountSource } from "../src/account-data";

export const now = Date.parse("2026-10-26T12:00:00Z");
export const alice = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "alice@example.invalid",
  emailVerified: false,
  methods: { password: true, google: false }
};
export const bob = {
  ...alice,
  id: "10000000-0000-4000-8000-000000000002",
  email: "bob@example.invalid"
};
export function stored(
  accessToken = "synthetic-access",
  expired = false
): StoredSession {
  return {
    version: 1,
    refreshPending: false,
    credentials: {
      accessToken,
      refreshToken: "r".repeat(43),
      tokenType: "Bearer",
      accessExpiresAt: new Date(now + (expired ? -1000 : 600000)).toISOString(),
      sessionExpiresAt: new Date(now + 86400000).toISOString()
    }
  };
}
export function response(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  } as Response;
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function harness(initial: StoredSession | null = stored()) {
  let disk = initial;
  const store = {
    read: jest
      .fn<CredentialStore["read"]>()
      .mockImplementation(async () => disk),
    write: jest
      .fn<CredentialStore["write"]>()
      .mockImplementation(async (value) => {
        disk = value;
      }),
    clear: jest.fn<CredentialStore["clear"]>().mockImplementation(async () => {
      disk = null;
    })
  };
  const fetcher = jest.fn<FetchRequest>().mockResolvedValue(response(alice));
  const proof = jest
    .fn<(nonce: string) => Promise<string | null>>()
    .mockResolvedValue("synthetic-provider-proof");
  const transport = createTransport("https://api.example.invalid", fetcher);
  const controller = createSessionController(
    store,
    transport,
    proof,
    () => now
  );
  const client = () => {
    const state = controller.getSnapshot();
    if (state.status !== "authenticated")
      throw new Error("Expected a verified test session.");
    return controller.client(state.generation);
  };
  return {
    controller,
    store,
    fetcher,
    proof,
    transport,
    client,
    disk: () => disk
  };
}

// Deterministic ports for UI tests: every posting still selects a real fixture account.
export const accountId = (currency: Currency = "USD") =>
  "70000000-0000-4000-8000-" +
  String(
    ["CAD", "USD", "EUR", "GBP", "INR", "JPY", "KWD"].indexOf(currency) + 1
  ).padStart(12, "0");
let requestSequence = 0;
export const requestId = () =>
  "80000000-0000-4000-8000-" + String(++requestSequence).padStart(12, "0");
export const accounts: AccountSource = {
  list: async () =>
    (["CAD", "USD", "EUR", "GBP", "INR", "JPY", "KWD"] as const).map(
      (currency) => ({
        id: accountId(currency),
        name: "Test " + currency,
        type: "cash",
        currency,
        openingBalanceMinor: 0,
        openingDate: "0001-01-01",
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z"
      })
    ),
  get: async (id, asOf = "2026-10-30") => {
    const row = (await accounts.list()).find((row) => row.id === id);
    if (!row) throw new Error("Missing fixture account");
    return { ...row, asOf, balanceMinor: 0 };
  },
  create: async () => {
    throw new Error("Unexpected fixture write");
  },
  update: async () => {
    throw new Error("Unexpected fixture write");
  },
  archive: async () => {
    throw new Error("Unexpected fixture write");
  }
};
