import type { PrismaClient, Category } from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
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
  return {
    async list(userId: string, query: CategoryQuery) {
      const rows = await db.category.findMany({
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
    },
    async get(userId: string, id: string) {
      const row = await db.category.findFirst({ where: { id, userId } });
      if (!row) throw unavailable();
      return serialize(row);
    },
    async create(userId: string, name: string) {
      return uniqueWrite(async () =>
        serialize(await db.category.create({ data: { userId, name } }))
      );
    },
    async rename(userId: string, id: string, name: string) {
      return uniqueWrite(() =>
        db.$transaction(async (tx) => {
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
      return db.$transaction(async (tx) => {
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
