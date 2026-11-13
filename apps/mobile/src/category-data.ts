import { defaultCategoryCatalog } from "../../api/src/categories/catalog.v1";
// A UI-facing port. Issue #11 supplies an adapter backed by verified sessions.
// This module never accepts credentials or performs network/storage operations.
export type Category = {
  id: string;
  name: string;
  isDefault: boolean;
  archivedAt: string | null;
  parentId?: string | null;
  sortOrder?: number;
  iconKey?: string;
  defaultKey?: string | null;
  colorKey?: string;
};
export interface CategorySource {
  hierarchy?: boolean;
  // Optional in-memory ledger hook; HTTP recents remain a server-owned query.
  recordPosting?(transactionId: string, categoryId: string | null): void;
  list(): Promise<Category[]>;
  recent(): Promise<Category[]>;
  create(name: string): Promise<string>;
  createChild?(name: string, parentId: string): Promise<string>;
  rename(id: string, name: string): Promise<void>;
  archive(id: string): Promise<void>;
}
export type CategoryReadSource = Pick<CategorySource, "list"> &
  Partial<Pick<CategorySource, "recent">>;
export class CategoryFailure extends Error {
  constructor(
    public code:
      | "validation"
      | "duplicate"
      | "unavailable"
      | "uncertain"
      | "read-only"
      | "invalid-parent"
  ) {
    super(code);
  }
}
export function categoryFailureMessage(error: unknown) {
  if (error instanceof CategoryFailure) {
    if (error.code === "read-only")
      return "Default categories cannot be changed.";
    if (error.code === "invalid-parent")
      return "Choose an active parent category. Reload the list.";
    if (error.code === "validation")
      return "Use a visible category name of 1–100 characters without control characters.";
    if (error.code === "duplicate")
      return "An active category already uses this name.";
    if (error.code === "uncertain")
      return "The change could not be confirmed. Reload the list before making another change.";
    return "This category is unavailable. Reload the list.";
  }
  return "Categories could not be updated or loaded. Try again.";
}

// Deliberately a simulation, not an API client or an authentication mechanism.
// Mirrors the API name rule so the demo can exercise validation and conflicts.
export function createDemoCategorySource({
  catalog = true
}: { catalog?: boolean } = {}): CategorySource {
  const defaults: Category[] = catalog
    ? defaultCategoryCatalog.items.map((item) => ({
        id: item.id,
        name: item.name,
        isDefault: true,
        defaultKey: item.key,
        parentId: item.parentKey
          ? defaultCategoryCatalog.items.find(
              (root) => root.key === item.parentKey
            )!.id
          : null,
        archivedAt: null,
        iconKey: item.iconKey,
        colorKey: item.colorKey,
        sortOrder: item.sortOrder
      }))
    : [];
  let personal: Category[] = [],
    sequence = 0,
    revision = 0;
  const postings = new Map<string, { categoryId: string; revision: number }>();
  const rows = () => [...defaults, ...personal];
  const key = (name: string) =>
    name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  function checkedName(raw: string, parentId: string | null, except?: string) {
    const name = raw.replace(/[ \t\n\r\f\v]+/g, " ").replace(/^ | $/g, "");
    if (
      raw.length > 1000 ||
      !name.length ||
      name.length > 100 ||
      /[\p{Cc}\p{Cf}\p{Cs}]/u.test(name) ||
      !/\S/u.test(name)
    )
      throw new CategoryFailure("validation");
    if (
      rows().some(
        (row) =>
          row.id !== except &&
          !row.archivedAt &&
          (row.parentId ?? null) === parentId &&
          key(row.name) === key(name)
      )
    )
      throw new CategoryFailure("duplicate");
    return name;
  }
  function owned(id: string) {
    const row = rows().find((row) => row.id === id);
    if (!row) throw new CategoryFailure("unavailable");
    if (row.isDefault) throw new CategoryFailure("read-only");
    return row;
  }
  async function create(raw: string, parentId: string | null = null) {
    if (parentId) {
      const parent = rows().find((row) => row.id === parentId);
      if (!parent) throw new CategoryFailure("unavailable");
      if (parent.parentId || parent.archivedAt)
        throw new CategoryFailure("invalid-parent");
    }
    const name = checkedName(raw, parentId);
    const row: Category = {
      id: `demo-${++sequence}`,
      name,
      parentId,
      isDefault: false,
      defaultKey: null,
      archivedAt: null,
      iconKey: "category",
      colorKey: "neutral",
      sortOrder: 0
    };
    personal.push(row);
    return row.id;
  }
  return {
    hierarchy: true,
    list: async () => rows().map((row) => ({ ...row })),
    recordPosting(id, categoryId) {
      if (categoryId === null) postings.delete(id);
      else postings.set(id, { categoryId, revision: ++revision });
    },
    async recent() {
      const visible = rows();
      const ids = [
        ...new Set(
          [...postings.values()]
            .sort((a, b) => b.revision - a.revision)
            .map((row) => row.categoryId)
        )
      ];
      return ids
        .flatMap((id) => {
          const row = visible.find((item) => item.id === id);
          const parent = row?.parentId
            ? visible.find((item) => item.id === row.parentId)
            : null;
          return row &&
            !row.archivedAt &&
            (!row.parentId || (parent && !parent.archivedAt))
            ? [{ ...row }]
            : [];
        })
        .slice(0, 8);
    },
    create,
    createChild: (raw, parentId) => create(raw, parentId),
    async rename(id, raw) {
      const row = owned(id);
      if (row.archivedAt) throw new CategoryFailure("unavailable");
      const name = checkedName(raw, row.parentId ?? null, id);
      personal = personal.map((item) =>
        item.id === id ? { ...item, name } : item
      );
    },
    async archive(id) {
      const row = owned(id);
      if (row.archivedAt) return;
      const archivedAt = new Date().toISOString();
      personal = personal.map((item) =>
        (item.id === id || item.parentId === id) && !item.archivedAt
          ? { ...item, archivedAt }
          : item
      );
    }
  };
}
