import { z } from "zod";

// Match the migration's explicit ASCII whitespace set, independent of DB locale.
export const normalizeCategoryName = (name: string) =>
  name.replace(/[ \t\n\r\f\v]+/g, " ").replace(/^ | $/g, "");

export const categoryInput = z.strictObject({
  name: z
    .string()
    .max(1000)
    .transform(normalizeCategoryName)
    .pipe(
      z
        .string()
        .min(1)
        .max(100)
        .refine(
          (name) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name) && /\S/u.test(name),
          "Use a visible name without control characters."
        )
    )
});
export const categorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export const categoryQuery = z.strictObject({
  status: z.enum(["active", "archived", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.uuid().optional()
});
export type CategoryQuery = z.infer<typeof categoryQuery>;
