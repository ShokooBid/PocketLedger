import { z } from "zod";
import { CategoryFailure, type CategorySource } from "./category-data";
import { ClientFailure, type Transport } from "./auth/transport";

const category = z.object({
  id: z.uuid(),
  name: z.string(),
  isDefault: z.boolean().describe("Shared immutable catalog membership."),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
const page = z.object({
  items: z.array(category),
  nextCursor: z.uuid().nullable()
});
const hierarchyCategory = category.extend({
  parentId: z.uuid().nullable(),
  defaultKey: z.string().nullable(),
  iconKey: z.string(),
  colorKey: z.string(),
  sortOrder: z.number().int()
});
export function createApiCategorySource(client: Transport): CategorySource {
  const base = "/v1/categories";
  const rowSchema = hierarchyCategory;
  const pageSchema = page.extend({ items: z.array(rowSchema) });
  async function mutate(method: "POST" | "PATCH", path: string, body: unknown) {
    try {
      return await client.send(method, path, rowSchema, body);
    } catch (error) {
      if (error instanceof ClientFailure) {
        if (error.code === "CATEGORY_NAME_CONFLICT")
          throw new CategoryFailure("duplicate");
        if (error.code === "DEFAULT_CATEGORY_READ_ONLY")
          throw new CategoryFailure("read-only");
        if (error.code === "INVALID_CATEGORY")
          throw new CategoryFailure("invalid-parent");
        if (error.kind === "validation")
          throw new CategoryFailure("validation");
        if (error.kind === "unavailable" || error.code === "CATEGORY_ARCHIVED")
          throw new CategoryFailure("unavailable");
        if (["network", "server", "protocol"].includes(error.kind))
          throw new CategoryFailure("uncertain");
      }
      throw error;
    }
  }
  return {
    hierarchy: true,
    async list() {
      const rows: z.infer<typeof rowSchema>[] = [];
      const cursors = new Set<string>();
      let after: string | null = null;
      do {
        const result: z.infer<typeof pageSchema> = await client.send(
          "GET",
          `${base}?status=all&limit=100${after ? `&after=${after}` : ""}`,
          pageSchema
        );
        rows.push(...result.items);
        after = result.nextCursor;
        if (after && (cursors.has(after) || result.items.length === 0))
          throw new ClientFailure("protocol");
        if (after) cursors.add(after);
      } while (after);
      return rows;
    },
    async recent() {
      const result = await client.send(
        "GET",
        `${base}/recent?limit=8`,
        z.object({
          items: z
            .array(rowSchema.extend({ parent: rowSchema.nullable() }))
            .max(8)
        })
      );
      return result.items;
    },
    create: async (name) => (await mutate("POST", base, { name })).id,
    createChild: async (name: string, parentId: string) =>
      (await mutate("POST", base, { name, parentId })).id,
    rename: async (id, name) => {
      await mutate("PATCH", `${base}/${encodeURIComponent(id)}`, { name });
    },
    archive: async (id) => {
      await mutate("POST", `${base}/${encodeURIComponent(id)}/archive`, {});
    }
  };
}
