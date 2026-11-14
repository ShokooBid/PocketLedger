import process from "node:process";
import { createDatabaseClient } from "../src/database.js";
import { transactionCreationFingerprint } from "../src/transactions/service.js";

if (
  process.env.NODE_ENV === "production" ||
  process.env.ALLOW_SYNTHETIC_SEED !== "true"
) {
  throw new Error(
    "Seeding requires ALLOW_SYNTHETIC_SEED=true outside production."
  );
}

// Explicit local/CI seeding must tolerate cold database queries while keeping
// all fixtures atomic. Application clients retain their own transaction limits.
const db = createDatabaseClient(process.env.DATABASE_URL ?? "", {
  maxWait: 30_000,
  timeout: 30_000
});
const userId = "00000000-0000-4000-8000-000000000001";
const foodId = "00000000-0000-4000-8000-000000000002";
const incomeId = "00000000-0000-4000-8000-000000000003";
const accountId = "00000000-0000-4000-8000-000000000007";
const importId = "00000000-0000-4000-8000-000000000004";

try {
  // Fixed IDs + empty updates make reruns additive, without rewriting edits.
  // One transaction prevents partial fixtures if an existing record conflicts.
  await db.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: "demo@example.invalid",
        // Deliberately not a password hash: this fixture cannot authenticate.
        passwordHash: "!disabled:synthetic-seed",
        disabledAt: new Date("2026-01-01T00:00:00Z")
      }
    });
    await tx.financePreferences.upsert({
      where: { userId },
      update: {},
      create: { userId, entryCurrency: "USD" }
    });
    await tx.account.upsert({
      where: { id: accountId },
      update: {},
      create: {
        id: accountId,
        userId,
        name: "Synthetic cash",
        type: "cash",
        currency: "USD",
        openingDate: new Date("2026-01-01"),
        openingBalanceMinor: 0
      }
    });
    for (const category of [
      { id: foodId, name: "Demo groceries" },
      { id: incomeId, name: "Demo income" }
    ]) {
      await tx.category.upsert({
        where: { id: category.id },
        update: {},
        create: { ...category, userId, isDefault: false }
      });
    }
    await tx.import.upsert({
      where: { id: importId },
      update: {},
      create: {
        id: importId,
        userId,
        status: "confirmed",
        confirmedAt: new Date("2026-01-15T12:00:00Z")
      }
    });
    const manual = {
      accountId,
      categoryId: foodId,
      direction: "expense" as const,
      amountMinor: 1234,
      date: "2026-01-15",
      note: "Synthetic manual transaction; no real purchase."
    };
    await tx.transaction.upsert({
      where: { id: "00000000-0000-4000-8000-000000000005" },
      update: {},
      create: {
        id: "00000000-0000-4000-8000-000000000005",
        userId,
        ...manual,
        date: new Date(manual.date),
        clientRequestId: "00000000-0000-4000-8000-000000000008",
        creationFingerprint: transactionCreationFingerprint(manual)
      }
    });
    await tx.transaction.upsert({
      where: { id: "00000000-0000-4000-8000-000000000006" },
      update: {},
      create: {
        id: "00000000-0000-4000-8000-000000000006",
        userId,
        accountId,
        categoryId: incomeId,
        importId,
        direction: "income",
        amountMinor: 250000,
        date: new Date("2026-01-01T00:00:00Z"),
        note: "Synthetic import example; no CSV or real employer."
      }
    });
  });
  console.info("Synthetic seed complete.");
} catch {
  // Do not print database URLs, queries, or record contents.
  console.error(
    "Synthetic seed failed. Check database setup and fixture conflicts."
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
