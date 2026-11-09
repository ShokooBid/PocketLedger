import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import {
  assertNewTransactionCurrency,
  lockFinanceOwner
} from "../preferences/service.js";
import { currencySchema } from "../transactions/contracts.js";
import {
  transferCreate,
  transferInput,
  type TransferCreate,
  type TransferInput,
  type TransferPatch,
  type TransferQuery
} from "./contracts.js";

const includeCurrency = {
  fromAccount: { select: { currency: true } }
} as const;
type Row = Prisma.TransferGetPayload<{ include: typeof includeCurrency }>;
const missing = () => new ApiError(404, "NOT_FOUND", "Resource not found.");
export function transferCreationFingerprint(input: TransferInput) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.fromAccountId.toLowerCase(),
        input.toAccountId.toLowerCase(),
        input.amountMinor,
        input.date,
        input.note || null
      ])
    )
    .digest("hex");
}
function serialize(row: Row) {
  return {
    id: row.id,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    amountMinor: row.amountMinor,
    date: row.date.toISOString().slice(0, 10),
    note: row.note,
    currency: currencySchema.parse(row.fromAccount.currency),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
async function eligible(
  tx: Prisma.TransactionClient,
  userId: string,
  input: TransferInput,
  previousCurrency?: string
) {
  if (input.fromAccountId.toLowerCase() === input.toAccountId.toLowerCase())
    throw new ApiError(
      422,
      "INVALID_TRANSFER",
      "Choose two distinct accounts."
    );
  const accounts = await tx.account.findMany({
    where: { userId, id: { in: [input.fromAccountId, input.toAccountId] } }
  });
  if (accounts.length !== 2) throw missing();
  if (
    accounts.some(
      (row) =>
        row.archivedAt ||
        input.date < row.openingDate.toISOString().slice(0, 10)
    )
  )
    throw new ApiError(
      422,
      "INVALID_ACCOUNT",
      "Transfer accounts must be active and open on the chosen date."
    );
  const currency = accounts[0]!.currency;
  if (
    accounts.some((row) => row.currency !== currency) ||
    (previousCurrency && previousCurrency !== currency)
  )
    throw new ApiError(
      422,
      "CURRENCY_MISMATCH",
      "Transfer accounts must use the same original currency; no conversion occurs."
    );
  await assertNewTransactionCurrency(tx, userId, currency);
}
async function writePostings(
  tx: Prisma.TransactionClient,
  row: Row,
  create: boolean
) {
  for (const direction of ["expense", "income"] as const) {
    const fields = {
      accountId: direction === "expense" ? row.fromAccountId : row.toAccountId,
      amountMinor: row.amountMinor,
      date: row.date,
      note: row.note
    };
    if (create)
      await tx.transaction.create({
        data: {
          ...fields,
          userId: row.userId,
          transferId: row.id,
          categoryId: null,
          direction
        }
      });
    else
      await tx.transaction.update({
        where: { transferId_direction: { transferId: row.id, direction } },
        data: fields
      });
  }
}
export function createTransferService(db: PrismaClient) {
  return {
    list(userId: string, query: TransferQuery) {
      return db.$transaction(async (tx) => {
        if (
          query.accountId &&
          !(await tx.account.findFirst({
            where: { id: query.accountId, userId }
          }))
        )
          throw missing();
        const rows = await tx.transfer.findMany({
          where: {
            userId,
            AND: [
              ...(query.accountId
                ? [
                    {
                      OR: [
                        { fromAccountId: query.accountId },
                        { toAccountId: query.accountId }
                      ]
                    }
                  ]
                : []),
              ...(query.from && query.to
                ? [
                    {
                      date: {
                        gte: new Date(query.from),
                        lte: new Date(query.to)
                      }
                    }
                  ]
                : []),
              ...(query.after
                ? [
                    {
                      OR: [
                        { date: { lt: new Date(query.after.slice(0, 10)) } },
                        {
                          date: new Date(query.after.slice(0, 10)),
                          id: { lt: query.after.slice(11) }
                        }
                      ]
                    }
                  ]
                : [])
            ]
          },
          orderBy: [{ date: "desc" }, { id: "desc" }],
          take: query.limit + 1,
          include: includeCurrency
        });
        const items = rows.slice(0, query.limit).map(serialize),
          last = items.at(-1);
        return {
          items,
          nextCursor:
            rows.length > query.limit && last ? `${last.date}_${last.id}` : null
        };
      });
    },
    async get(userId: string, id: string) {
      const row = await db.transfer.findFirst({
        where: { id, userId },
        include: includeCurrency
      });
      if (!row) throw missing();
      return serialize(row);
    },
    create(userId: string, request: TransferCreate) {
      const { clientRequestId, ...fields } = transferCreate.parse(request);
      const input = { ...fields, note: fields.note || null },
        creationFingerprint = transferCreationFingerprint(input);
      return db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        const previous = await tx.transfer.findUnique({
          where: { userId_clientRequestId: { userId, clientRequestId } },
          include: includeCurrency
        });
        // Replay before eligibility: an edited or archived resource is still the
        // same creation. Hard deletion removes this lookup/identity together.
        if (previous) {
          if (previous.creationFingerprint !== creationFingerprint)
            throw new ApiError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "This creation key belongs to a different transfer payload."
            );
          return { resource: serialize(previous), replayed: true };
        }
        await eligible(tx, userId, input);
        const row = await tx.transfer.create({
          data: {
            ...input,
            date: new Date(input.date),
            userId,
            clientRequestId,
            creationFingerprint
          },
          include: includeCurrency
        });
        await writePostings(tx, row, true);
        return { resource: serialize(row), replayed: false };
      });
    },
    update(userId: string, id: string, patch: TransferPatch) {
      return db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        const previous = await tx.transfer.findFirst({
          where: { id, userId },
          include: includeCurrency
        });
        if (!previous) throw missing();
        const input = transferInput.parse({
          fromAccountId: previous.fromAccountId,
          toAccountId: previous.toAccountId,
          amountMinor: previous.amountMinor,
          date: previous.date.toISOString().slice(0, 10),
          note: previous.note,
          ...patch
        });
        await eligible(tx, userId, input, previous.fromAccount.currency);
        const row = await tx.transfer.update({
          where: { id },
          data: {
            ...input,
            note: input.note || null,
            date: new Date(input.date)
          },
          include: includeCurrency
        });
        await writePostings(tx, row, false);
        return serialize(row);
      });
    },
    remove(userId: string, id: string) {
      return db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        if (!(await tx.transfer.findFirst({ where: { id, userId } })))
          throw missing();
        await tx.transaction.deleteMany({ where: { transferId: id, userId } });
        await tx.transfer.delete({ where: { id } });
        return { ok: true as const };
      });
    }
  };
}
export type TransferService = ReturnType<typeof createTransferService>;
