import type { Category } from "./category-data";

export function categoryPath(row: Category, rows: Category[]) {
  const parent = row.parentId
    ? rows.find((item) => item.id === row.parentId)
    : null;
  return parent ? `${parent.name} / ${row.name}` : row.name;
}
export function orderedCategories(rows: Category[]) {
  const compare = (a: Category, b: Category) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id);
  return rows
    .filter((row) => !row.parentId)
    .sort(compare)
    .flatMap((root) => [
      root,
      ...rows.filter((row) => row.parentId === root.id).sort(compare)
    ]);
}
export function activeCategoryChildren(root: Category, rows: Category[]) {
  return rows.filter((row) => row.parentId === root.id && !row.archivedAt);
}
