import { randomUUID } from "node:crypto";
import type {
  Category,
  Prisma,
  PrismaClient
} from "../generated/prisma/client.js";
import { lockFinanceOwner } from "../preferences/service.js";
import { normalizeCategoryName } from "./contracts.js";
import { defaultCategoryCatalog } from "./catalog.v1.js";

export type CatalogConflict = {
  catalogKey: string;
  categoryId: string;
  reason: "active-name" | "catalog-identity" | "archived-parent";
};
export class CategoryCatalogConflict extends Error {
  constructor(public readonly conflicts: CatalogConflict[]) {
    super("Resolve category catalog conflicts before provisioning this owner.");
  }
}
const nameKey = (name: string) =>
  normalizeCategoryName(name).replace(/[A-Z]/g, (letter) =>
    letter.toLowerCase()
  );

// Plan the entire tree before writing. Never adopt, rename, reparent or merge
// an existing personal/historical category to resolve a catalog collision.
export function planCategoryCatalog(
  existing: readonly Category[],
  userId: string
) {
  const byKey = new Map(
    existing
      .filter((row) => row.defaultKey !== null)
      .map((row) => [row.defaultKey!, row])
  );
  const ids = new Map(
    defaultCategoryCatalog.items.map((item) => [
      item.key,
      byKey.get(item.key)?.id ?? randomUUID()
    ])
  );
  const data: Prisma.CategoryCreateManyInput[] = [];
  const conflicts: CatalogConflict[] = [];
  for (const item of defaultCategoryCatalog.items) {
    const parentId = item.parentKey ? ids.get(item.parentKey)! : null;
    const current = byKey.get(item.key);
    if (current) {
      if (!current.isDefault || current.parentId !== parentId)
        conflicts.push({
          catalogKey: item.key,
          categoryId: current.id,
          reason: "catalog-identity"
        });
      // Preserve keyed rows verbatim, including previous labels and archives.
      continue;
    }
    const parent = item.parentKey ? byKey.get(item.parentKey) : null;
    if (parent?.archivedAt) {
      conflicts.push({
        catalogKey: item.key,
        categoryId: parent.id,
        reason: "archived-parent"
      });
      continue;
    }
    const duplicate = existing.find(
      (row) =>
        !row.archivedAt &&
        row.parentId === parentId &&
        nameKey(row.name) === nameKey(item.name)
    );
    if (duplicate) {
      conflicts.push({
        catalogKey: item.key,
        categoryId: duplicate.id,
        reason: "active-name"
      });
      continue;
    }
    data.push({
      id: ids.get(item.key)!,
      userId,
      parentId,
      defaultKey: item.key,
      name: item.name,
      isDefault: true,
      iconKey: item.iconKey,
      colorKey: item.colorKey,
      sortOrder: item.sortOrder
    });
  }
  return { data, conflicts };
}

// Caller owns the transaction. Signup creates user/tree/session atomically;
// backfill uses this same service in one transaction per existing owner.
export async function provisionCategoryCatalog(
  tx: Prisma.TransactionClient,
  userId: string,
  apply = true
) {
  await lockFinanceOwner(tx, userId);
  const plan = planCategoryCatalog(
    await tx.category.findMany({ where: { userId } }),
    userId
  );
  if (plan.conflicts.length) throw new CategoryCatalogConflict(plan.conflicts);
  if (apply && plan.data.length)
    await tx.category.createMany({ data: plan.data });
  return {
    catalogVersion: defaultCategoryCatalog.version,
    created: apply ? plan.data.length : 0,
    pending: apply ? 0 : plan.data.length
  };
}

export async function backfillCategoryCatalog(
  db: PrismaClient,
  options: { after?: string | undefined; limit: number; apply: boolean }
) {
  const owners = await db.user.findMany({
    where: options.after ? { id: { gt: options.after } } : {},
    select: { id: true },
    orderBy: { id: "asc" },
    take: options.limit + 1
  });
  const results = [];
  for (const owner of owners.slice(0, options.limit)) {
    try {
      const result = await db.$transaction((tx) =>
        provisionCategoryCatalog(tx, owner.id, options.apply)
      );
      results.push({
        userId: owner.id,
        ...result,
        conflicts: [] as CatalogConflict[]
      });
    } catch (error) {
      if (!(error instanceof CategoryCatalogConflict)) throw error;
      results.push({
        userId: owner.id,
        catalogVersion: defaultCategoryCatalog.version,
        created: 0,
        pending: 0,
        conflicts: error.conflicts
      });
    }
  }
  return {
    results,
    nextCursor: owners.length > options.limit ? results.at(-1)!.userId : null
  };
}
