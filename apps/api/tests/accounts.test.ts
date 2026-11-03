import { describe, expect, it } from "vitest";
import {
  accountInput,
  accountPatch,
  accountQuery
} from "../src/accounts/contracts.js";
import { preferencesPatch } from "../src/preferences/contracts.js";
import { readConfig } from "../src/config.js";

const input = {
  name: "My cash",
  type: "cash",
  currency: "CAD",
  openingDate: "2026-10-31"
};
describe("account contracts", () => {
  it("normalizes names and defaults the signed exact opening balance to zero", () => {
    expect(
      accountInput.parse({ ...input, name: "  My\t cash\n " })
    ).toMatchObject({ name: "My cash", openingBalanceMinor: 0 });
    for (const openingBalanceMinor of [-2147483647, -1, 0, 1, 2147483647])
      expect(
        accountInput.parse({ ...input, openingBalanceMinor })
          .openingBalanceMinor
      ).toBe(openingBalanceMinor);
    for (const openingDate of ["0001-01-01", "2024-02-29", "9999-12-31"])
      expect(accountInput.safeParse({ ...input, openingDate }).success).toBe(
        true
      );
  });
  it("rejects invisible/oversized names, invalid calendar dates, coercion and forged fields", () => {
    for (const extra of [
      { name: " " },
      { name: "\u200b" },
      { name: "\ud800" },
      { name: "a\u0000b" },
      { name: "a".repeat(101) },
      { name: " ".repeat(1001) },
      { openingDate: "0000-01-01" },
      { openingDate: "2026-02-29" },
      { openingDate: "2026-04-31" },
      { openingDate: "2026-10-31T00:00:00Z" },
      { openingBalanceMinor: 1.5 },
      { openingBalanceMinor: "100" },
      { openingBalanceMinor: -2147483648 },
      { openingBalanceMinor: 2147483648 },
      { currency: "cad" },
      { currency: "XYZ" },
      { type: "BMO" },
      { userId: "forged" },
      { balanceMinor: 100 },
      { archivedAt: null }
    ])
      expect(
        accountInput.safeParse({ ...input, ...extra }).success,
        JSON.stringify(extra)
      ).toBe(false);
    for (const patch of [
      {},
      { currency: "USD" },
      { openingDate: "2026-10-31" },
      { openingBalanceMinor: 1 }
    ])
      expect(accountPatch.safeParse(patch).success).toBe(false);
    expect(preferencesPatch.safeParse({}).success).toBe(false);
    expect(preferencesPatch.safeParse({ defaultAccountId: null }).success).toBe(
      true
    );
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { status: "unknown" },
      { after: "invalid" },
      { userId: "forged" }
    ])
      expect(accountQuery.safeParse(query).success).toBe(false);
  });
  it("requires both explicit account and currency rollout flags", () => {
    const env = {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://unused:unused@127.0.0.1/unused",
      ACCESS_TOKEN_SECRET: "A".repeat(43)
    };
    expect(readConfig(env).accountsEnabled).toBe(false);
    expect(
      readConfig({ ...env, FINANCE_ACCOUNTS_ENABLED: "true" }).accountsEnabled
    ).toBe(false);
    expect(
      readConfig({
        ...env,
        FINANCE_ACCOUNTS_ENABLED: "true",
        FINANCE_CURRENCY_ENABLED: "true"
      }).accountsEnabled
    ).toBe(true);
  });
});
