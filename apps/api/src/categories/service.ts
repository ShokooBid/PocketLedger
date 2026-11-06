import type {
  Category,
  Prisma,
  PrismaClient
} from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { lockFinanceOwner } from "../preferences/service.js";
import type {
  CategoryInput,
  CategoryPatch,
  CategoryQuery
} from "./contracts.js";

export const serializeCategory = (row: Category) => ({
  id: row.id,
  name: row.name,
  parentId: row.parentId,
  isDefault: row.userId === null,
  defaultKey: row.defaultKey,
  iconKey: row.iconKey,
  colorKey: row.colorKey,
  sortOrder: row.sortOrder,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
});
const missing = () => new ApiError(404, "NOT_FOUND", "Resource not found.");
const invalid = () =>
  new ApiError(422, "INVALID_CATEGORY", "Choose an active root category.");
export const visibleCategory = (userId: string): Prisma.CategoryWhereInput => ({
  OR: [{ userId: null }, { userId }]
});
async function visible(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string
) {
  const row = await tx.category.findFirst({
    where: { id, AND: [visibleCategory(userId)] }
  });
  if (!row) throw missing();
  return row;
}
function writable(row: Category) {
  if (row.userId === null)
    throw new ApiError(
      409,
      "DEFAULT_CATEGORY_READ_ONLY",
      "Default categories cannot be changed."
    );
}

export function createCategoryService(db: PrismaClient) {
  async function write<T>(
    userId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    try {
      return await db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        return action(tx);
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new ApiError(
          409,
          "CATEGORY_NAME_CONFLICT",
          "An active sibling category already uses this name."
        );
      throw error;
    }
  }
  return {
    async assertMutable(userId: string, id: string) {
      writable(await visible(db, userId, id));
    },
    async list(userId: string, query: CategoryQuery) {
      // A parent filter is a shared-or-owned root lookup, including archived roots for history.
      if (query.parentId && query.parentId !== "root") {
        const parent = await visible(db, userId, query.parentId);
        if (parent.parentId) throw invalid();
      }
      const rows = await db.category.findMany({
        where: {
          AND: [visibleCategory(userId)],
          ...(query.status === "active"
            ? {
                archivedAt: null,
                OR: [{ parentId: null }, { parent: { archivedAt: null } }]
              }
            : query.status === "archived"
              ? { archivedAt: { not: null } }
              : {}),
          ...(query.parentId
            ? { parentId: query.parentId === "root" ? null : query.parentId }
            : {}),
          ...(query.q
            ? { name: { contains: query.q, mode: "insensitive" as const } }
            : {}),
          ...(query.after ? { id: { gt: query.after } } : {})
        },
        orderBy: { id: "asc" },
        take: query.limit + 1
      });
      const items = rows.slice(0, query.limit).map(serializeCategory);
      return {
        items,
        nextCursor: rows.length > query.limit ? items.at(-1)!.id : null
      };
    },
    async get(userId: string, id: string) {
      return serializeCategory(await visible(db, userId, id));
    },
    async recent(userId: string, limit: number) {
      return db.$transaction(
        async (tx) => {
          // Independent of history pagination. GROUP BY yields one selection each;
          // both active category and active ancestor are required.
          const selections = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM "Category" c
        JOIN "Transaction" t ON t."categoryId" = c.id AND t."userId" = ${userId}::uuid
        LEFT JOIN "Category" p ON p.id = c."parentId" AND (p."userId" IS NULL OR p."userId" = t."userId")
        WHERE (c."userId" IS NULL OR c."userId" = ${userId}::uuid) AND c."archivedAt" IS NULL
          AND (c."parentId" IS NULL OR (p.id IS NOT NULL AND p."archivedAt" IS NULL))
        GROUP BY c.id ORDER BY MAX(t."updatedAt") DESC, c.id ASC LIMIT ${limit}
      `;
          const rows = await tx.category.findMany({
            where: {
              AND: [visibleCategory(userId)],
              id: { in: selections.map((row) => row.id) }
            },
            include: { parent: true }
          });
          return {
            items: selections.flatMap(({ id }) => {
              const row = rows.find((row) => row.id === id);
              return row
                ? [
                    {
                      ...serializeCategory(row),
                      parent: row.parent ? serializeCategory(row.parent) : null
                    }
                  ]
                : [];
            })
          };
        },
        { isolationLevel: "RepeatableRead" }
      );
    },
    create(userId: string, input: CategoryInput) {
      return write(userId, async (tx) => {
        if (input.parentId) {
          const parent = await visible(tx, userId, input.parentId);
          if (parent.parentId || parent.archivedAt) throw invalid();
        }
        return serializeCategory(
          await tx.category.create({
            data: {
              userId,
              name: input.name,
              parentId: input.parentId ?? null,
              ...(input.iconKey !== undefined
                ? { iconKey: input.iconKey }
                : {}),
              ...(input.colorKey !== undefined
                ? { colorKey: input.colorKey }
                : {}),
              ...(input.sortOrder !== undefined
                ? { sortOrder: input.sortOrder }
                : {})
            }
          })
        );
      });
    },
    update(userId: string, id: string, input: CategoryPatch) {
      return write(userId, async (tx) => {
        const row = await visible(tx, userId, id);
        writable(row);
        if (row.archivedAt)
          throw new ApiError(
            409,
            "CATEGORY_ARCHIVED",
            "Archived categories cannot be changed."
          );
        return serializeCategory(
          await tx.category.update({
            where: { id, userId },
            data: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.iconKey !== undefined
                ? { iconKey: input.iconKey }
                : {}),
              ...(input.colorKey !== undefined
                ? { colorKey: input.colorKey }
                : {}),
              ...(input.sortOrder !== undefined
                ? { sortOrder: input.sortOrder }
                : {})
            }
          })
        );
      });
    },
    archive(userId: string, id: string) {
      return write(userId, async (tx) => {
        const row = await visible(tx, userId, id);
        writable(row);
        // The DB trigger archives active children in this same transaction.
        return serializeCategory(
          row.archivedAt
            ? row
            : await tx.category.update({
                where: { id, userId },
                data: { archivedAt: new Date() }
              })
        );
      });
    }
  };
}
export type CategoryService = ReturnType<typeof createCategoryService>;
