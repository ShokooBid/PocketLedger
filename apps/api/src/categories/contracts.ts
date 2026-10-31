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

// Semantic identifiers, never arbitrary CSS, SVG or image URLs. Neutral defaults
// are intentional until #67/#71 supply the visual vocabulary.
const presentationKey = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const presentation = {
  iconKey: presentationKey.optional(),
  colorKey: presentationKey.optional(),
  sortOrder: z.number().int().min(0).max(1000000).optional()
};
export const hierarchyCategoryInput = categoryInput.extend({
  parentId: z.uuid().nullable().optional(),
  ...presentation
});
export const hierarchyCategoryPatch = categoryInput
  .extend(presentation)
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const hierarchyCategorySchema = categorySchema.extend({
  parentId: z.uuid().nullable(),
  defaultKey: z.string().nullable(),
  iconKey: presentationKey,
  colorKey: presentationKey,
  sortOrder: z.number().int().min(0).max(1000000)
});
export const hierarchyCategoryQuery = categoryQuery.extend({
  parentId: z.union([z.uuid(), z.literal("root")]).optional(),
  q: z
    .string()
    .max(1000)
    .transform(normalizeCategoryName)
    .pipe(z.string().max(100))
    .optional()
});
export const recentCategoryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(8)
});
export type HierarchyCategoryInput = z.infer<typeof hierarchyCategoryInput>;
export type HierarchyCategoryPatch = z.infer<typeof hierarchyCategoryPatch>;
export type HierarchyCategoryQuery = z.infer<typeof hierarchyCategoryQuery>;
