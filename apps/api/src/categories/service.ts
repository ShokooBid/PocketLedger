import type {
  PrismaClient,
  Category,
  Prisma
} from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { lockFinanceOwner } from "../preferences/service.js";
import type { CategoryQuery } from "./contracts.js";

const unavailable = () => new ApiError(404, "NOT_FOUND", "Resource not found.");
const serialize = (category: Category) => ({
  id: category.id,
  name: category.name,
  isDefault: category.isDefault,
  archivedAt: category.archivedAt?.toISOString() ?? null,
  createdAt: category.createdAt.toISOString(),
  updatedAt: category.updatedAt.toISOString()
});

async function uniqueWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    // The partial unique index is the authority, including concurrent writes.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    )
      throw new ApiError(
        409,
        "CATEGORY_NAME_CONFLICT",
        "An active category already uses this name."
      );
    throw error;
  }
}

export function createCategoryService(db: PrismaClient) {
  async function legacy<T>(
    userId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    return db.$transaction(async (tx) => {
      await lockFinanceOwner(tx, userId);
      if (
        await tx.category.findFirst({
          where: {
            userId,
            OR: [{ parentId: { not: null } }, { defaultKey: { not: null } }]
          },
          select: { id: true }
        })
      )
        throw new ApiError(
          409,
          "FINANCE_UPGRADE_REQUIRED",
          "Use the supported category client."
        );
      return action(tx);
    });
  }
  function writable(row: Category) {
    if (row.isDefault)
      throw new ApiError(
        409,
        "DEFAULT_CATEGORY_READ_ONLY",
        "Default categories cannot be changed."
      );
  }
  return {
    async list(userId: string, query: CategoryQuery) {
      return legacy(userId, async (tx) => {
        const rows = await tx.category.findMany({
          where: {
            userId,
            ...(query.status === "active"
              ? { archivedAt: null }
              : query.status === "archived"
                ? { archivedAt: { not: null } }
                : {}),
            ...(query.after ? { id: { gt: query.after } } : {})
          },
          orderBy: { id: "asc" },
          take: query.limit + 1
        });
        const items = rows.slice(0, query.limit).map(serialize);
        return {
          items,
          nextCursor: rows.length > query.limit ? items.at(-1)!.id : null
        };
      });
    },
    async get(userId: string, id: string) {
      return legacy(userId, async (tx) => {
        const row = await tx.category.findFirst({ where: { id, userId } });
        if (!row) throw unavailable();
        return serialize(row);
      });
    },
    async create(userId: string, name: string) {
      return uniqueWrite(async () =>
        legacy(userId, async (tx) =>
          serialize(await tx.category.create({ data: { userId, name } }))
        )
      );
    },
    async rename(userId: string, id: string, name: string) {
      return uniqueWrite(() =>
        legacy(userId, async (tx) => {
          const row = await tx.category.findFirst({ where: { id, userId } });
          if (!row) throw unavailable();
          writable(row);
          const changed = await tx.category.updateMany({
            where: { id, userId, archivedAt: null },
            data: { name }
          });
          if (!changed.count) {
            const owned = await tx.category.findFirst({
              where: { id, userId }
            });
            if (!owned) throw unavailable();
            throw new ApiError(
              409,
              "CATEGORY_ARCHIVED",
              "Archived categories cannot be renamed."
            );
          }
          return serialize(
            await tx.category.findFirstOrThrow({ where: { id, userId } })
          );
        })
      );
    },
    async archive(userId: string, id: string) {
      return legacy(userId, async (tx) => {
        const owned = await tx.category.findFirst({ where: { id, userId } });
        if (!owned) throw unavailable();
        writable(owned);
        // Idempotent: a second archive preserves the original timestamp.
        await tx.category.updateMany({
          where: { id, userId, archivedAt: null },
          data: { archivedAt: new Date() }
        });
        const row = await tx.category.findFirst({ where: { id, userId } });
        if (!row) throw unavailable();
        return serialize(row);
      });
    }
  };
}
export type CategoryService = ReturnType<typeof createCategoryService>;
