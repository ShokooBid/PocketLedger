import { z } from "zod";
import { CategoryFailure, type CategorySource } from "./category-data";
import { ClientFailure, type Transport } from "./auth/transport";

const category = z.object({
  id: z.uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
const page = z.object({
  items: z.array(category),
  nextCursor: z.uuid().nullable()
});
export function createApiCategorySource(client: Transport): CategorySource {
  async function mutate(method: "POST" | "PATCH", path: string, body: unknown) {
    try {
      await client.send(method, path, category, body);
    } catch (error) {
      if (error instanceof ClientFailure) {
        if (error.kind === "validation")
          throw new CategoryFailure("validation");
        if (error.code === "CATEGORY_NAME_CONFLICT")
          throw new CategoryFailure("duplicate");
        if (error.kind === "unavailable" || error.code === "CATEGORY_ARCHIVED")
          throw new CategoryFailure("unavailable");
        if (["network", "server", "protocol"].includes(error.kind))
          throw new CategoryFailure("uncertain");
      }
      throw error;
    }
  }
  return {
    async list() {
      const rows: z.infer<typeof category>[] = [];
      const cursors = new Set<string>();
      let after: string | null = null;
      do {
        const result: z.infer<typeof page> = await client.send(
          "GET",
          `/v1/categories?status=all&limit=100${after ? `&after=${after}` : ""}`,
          page
        );
        rows.push(...result.items);
        after = result.nextCursor;
        if (after && (cursors.has(after) || result.items.length === 0))
          throw new ClientFailure("protocol");
        if (after) cursors.add(after);
      } while (after);
      return rows;
    },
    create: (name) => mutate("POST", "/v1/categories", { name }),
    rename: (id, name) =>
      mutate("PATCH", `/v1/categories/${encodeURIComponent(id)}`, { name }),
    archive: (id) =>
      mutate("POST", `/v1/categories/${encodeURIComponent(id)}/archive`, {})
  };
}
