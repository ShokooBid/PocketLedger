// A UI-facing port. Issue #11 supplies an adapter backed by verified sessions.
// This module never accepts credentials or performs network/storage operations.
export type Category = {
  id: string;
  name: string;
  isDefault: boolean;
  archivedAt: string | null;
};
export interface CategorySource {
  list(): Promise<Category[]>;
  create(name: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  archive(id: string): Promise<void>;
}
export class CategoryFailure extends Error {
  constructor(public code: "validation" | "duplicate" | "unavailable") {
    super(code);
  }
}
export function categoryFailureMessage(error: unknown) {
  if (error instanceof CategoryFailure) {
    if (error.code === "validation")
      return "Use a visible category name of 1–100 characters without control characters.";
    if (error.code === "duplicate")
      return "An active category already uses this name.";
    return "This category is unavailable. Reload the list.";
  }
  return "Categories could not be updated or loaded. Try again.";
}

// Deliberately a simulation, not an API client or an authentication mechanism.
// Mirrors the API name rule so the demo can exercise validation and conflicts.
export function createDemoCategorySource(): CategorySource {
  let rows: Category[] = [];
  let sequence = 0;
  const key = (name: string) =>
    name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  function checkedName(raw: string, except?: string) {
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
      rows.some(
        (row) =>
          row.id !== except && !row.archivedAt && key(row.name) === key(name)
      )
    )
      throw new CategoryFailure("duplicate");
    return name;
  }
  return {
    async list() {
      return rows.map((row) => ({ ...row }));
    },
    async create(raw) {
      const name = checkedName(raw);
      rows = [
        ...rows,
        { id: `demo-${++sequence}`, name, isDefault: false, archivedAt: null }
      ];
    },
    async rename(id, raw) {
      const row = rows.find((row) => row.id === id && !row.archivedAt);
      if (!row) throw new CategoryFailure("unavailable");
      const name = checkedName(raw, id);
      rows = rows.map((row) => (row.id === id ? { ...row, name } : row));
    },
    async archive(id) {
      if (!rows.some((row) => row.id === id))
        throw new CategoryFailure("unavailable");
      rows = rows.map((row) =>
        row.id === id && !row.archivedAt
          ? { ...row, archivedAt: new Date().toISOString() }
          : row
      );
    }
  };
}
