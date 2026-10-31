import type {
  Category,
  Prisma,
  PrismaClient
} from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { lockFinanceOwner } from "../preferences/service.js";
import type {
  HierarchyCategoryInput,
  HierarchyCategoryPatch,
  HierarchyCategoryQuery
} from "./contracts.js";

export const serializeHierarchyCategory = (row: Category) => ({
  id: row.id,
  name: row.name,
  parentId: row.parentId,
  isDefault: row.isDefault,
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
async function owned(tx: Prisma.TransactionClient, userId: string, id: string) {
  const row = await tx.category.findFirst({ where: { id, userId } });
  if (!row) throw missing();
  return row;
}
function writable(row: Category) {
  if (row.isDefault)
    throw new ApiError(
      409,
      "DEFAULT_CATEGORY_READ_ONLY",
      "Default categories cannot be changed."
    );
}

export function createHierarchyCategoryService(
  db: PrismaClient,
  enabled = false
) {
  function available() {
    if (!enabled)
      throw new ApiError(
        409,
        "FINANCE_FEATURE_DISABLED",
        "Category hierarchy is not enabled in this release."
      );
  }
  async function write<T>(
    userId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    available();
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
      available();
      writable(await owned(db, userId, id));
    },
    async list(userId: string, query: HierarchyCategoryQuery) {
      available();
      // A parent filter is an owned root lookup, including archived roots for history.
      if (query.parentId && query.parentId !== "root") {
        const parent = await owned(db, userId, query.parentId);
        if (parent.parentId) throw invalid();
      }
      const rows = await db.category.findMany({
        where: {
          userId,
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
      const items = rows.slice(0, query.limit).map(serializeHierarchyCategory);
      return {
        items,
        nextCursor: rows.length > query.limit ? items.at(-1)!.id : null
      };
    },
    async get(userId: string, id: string) {
      available();
      return serializeHierarchyCategory(await owned(db, userId, id));
    },
    async recent(userId: string, limit: number) {
      available();
      return db.$transaction(
        async (tx) => {
          // Independent of history pagination. GROUP BY yields one selection each;
          // both active category and active ancestor are required.
          const selections = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM "Category" c
        JOIN "Transaction" t ON t."categoryId" = c.id AND t."userId" = c."userId"
        LEFT JOIN "Category" p ON p.id = c."parentId" AND p."userId" = c."userId"
        WHERE c."userId" = ${userId}::uuid AND c."archivedAt" IS NULL
          AND (c."parentId" IS NULL OR p."archivedAt" IS NULL)
        GROUP BY c.id ORDER BY MAX(t."updatedAt") DESC, c.id ASC LIMIT ${limit}
      `;
          const rows = await tx.category.findMany({
            where: { userId, id: { in: selections.map((row) => row.id) } },
            include: { parent: true }
          });
          return {
            items: selections.flatMap(({ id }) => {
              const row = rows.find((row) => row.id === id);
              return row
                ? [
                    {
                      ...serializeHierarchyCategory(row),
                      parent: row.parent
                        ? serializeHierarchyCategory(row.parent)
                        : null
                    }
                  ]
                : [];
            })
          };
        },
        { isolationLevel: "RepeatableRead" }
      );
    },
    create(userId: string, input: HierarchyCategoryInput) {
      return write(userId, async (tx) => {
        if (input.parentId) {
          const parent = await owned(tx, userId, input.parentId);
          if (parent.parentId || parent.archivedAt) throw invalid();
        }
        return serializeHierarchyCategory(
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
    update(userId: string, id: string, input: HierarchyCategoryPatch) {
      return write(userId, async (tx) => {
        const row = await owned(tx, userId, id);
        writable(row);
        if (row.archivedAt)
          throw new ApiError(
            409,
            "CATEGORY_ARCHIVED",
            "Archived categories cannot be changed."
          );
        return serializeHierarchyCategory(
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
        const row = await owned(tx, userId, id);
        writable(row);
        // The DB trigger archives active children in this same transaction.
        return serializeHierarchyCategory(
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
export type HierarchyCategoryService = ReturnType<
  typeof createHierarchyCategoryService
>;
