import { z } from "zod";
import { financeName, normalizeFinanceName } from "../finance/names.js";

// Match the migration's explicit ASCII whitespace set, independent of DB locale.
export const normalizeCategoryName = normalizeFinanceName;

const baseInput = z.strictObject({
  name: financeName
});
const baseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
const baseQuery = z.strictObject({
  status: z.enum(["active", "archived", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.uuid().optional()
});

// Semantic identifiers, never arbitrary CSS, SVG or image URLs. Neutral defaults
// are intentional until #67/#71 supply the visual vocabulary.
const presentationKey = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const presentation = {
  iconKey: presentationKey.optional(),
  colorKey: presentationKey.optional(),
  sortOrder: z.number().int().min(0).max(1000000).optional()
};
export const categoryInput = baseInput.extend({
  parentId: z.uuid().nullable().optional(),
  ...presentation
});
export const categoryPatch = baseInput
  .extend(presentation)
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const categorySchema = baseSchema.extend({
  parentId: z.uuid().nullable(),
  defaultKey: z.string().nullable(),
  iconKey: presentationKey,
  colorKey: presentationKey,
  sortOrder: z.number().int().min(0).max(1000000)
});
export const categoryQuery = baseQuery.extend({
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
export type CategoryInput = z.infer<typeof categoryInput>;
export type CategoryPatch = z.infer<typeof categoryPatch>;
export type CategoryQuery = z.infer<typeof categoryQuery>;
