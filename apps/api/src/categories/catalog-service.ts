import type { PrismaClient } from "../generated/prisma/client.js";
import { defaultCategoryCatalog } from "./catalog.v1.js";

// Explicit deployment operation, never signup, login, or API startup.
// Reruns only insert missing approved rows; drift requires a deliberate migration.
export function initializeCategoryCatalog(db: PrismaClient) {
  return db.$transaction(
    async (tx) => {
      // Select an integer so Prisma never needs to deserialize PostgreSQL void.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(
        hashtextextended(current_schema() || ':category-catalog', 0))`;
      const existing = await tx.category.findMany({ where: { userId: null } });
      if (
        existing.some(
          (row) =>
            !defaultCategoryCatalog.items.some(
              (item) => item.key === row.defaultKey
            )
        )
      )
        throw new Error("Shared catalog differs from the approved manifest.");
      let created = 0;
      for (const item of defaultCategoryCatalog.items) {
        const parentId = item.parentKey
          ? defaultCategoryCatalog.items.find(
              (root) => root.key === item.parentKey
            )!.id
          : null;
        const current = existing.find((row) => row.defaultKey === item.key);
        if (current) {
          if (
            current.id !== item.id ||
            current.parentId !== parentId ||
            current.name !== item.name ||
            !current.isDefault ||
            current.archivedAt !== null ||
            current.iconKey !== item.iconKey ||
            current.colorKey !== item.colorKey ||
            current.sortOrder !== item.sortOrder
          )
            throw new Error(
              "Shared catalog differs from the approved manifest."
            );
          continue;
        }
        await tx.category.create({
          data: {
            id: item.id,
            userId: null,
            parentId,
            defaultKey: item.key,
            name: item.name,
            isDefault: true,
            iconKey: item.iconKey,
            colorKey: item.colorKey,
            sortOrder: item.sortOrder
          }
        });
        created++;
      }
      return {
        catalogVersion: defaultCategoryCatalog.version,
        created,
        total: defaultCategoryCatalog.items.length
      };
    },
    { timeout: 30_000 }
  );
}
