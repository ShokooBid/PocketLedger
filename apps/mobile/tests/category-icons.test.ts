import { describe, expect, it } from "@jest/globals";
import { categoryIconAssets } from "../src/category-icon-assets";
import { categoryIconXml } from "../src/category-icon-data";

describe("bundled category icon selection", () => {
  it("maps all defaults and keeps repeated child names distinct", () => {
    expect(Object.values(categoryIconAssets)).toHaveLength(80);
    expect(
      new Set(
        Object.values(categoryIconAssets).map((asset) => asset.defaultKey)
      ).size
    ).toBe(80);
    expect(
      categoryIconAssets["financial-expenses-child-support"]?.filename
    ).toBe("Financial expenses-Child Support.svg");
    expect(categoryIconAssets["income-child-support"]?.filename).toBe(
      "Income-Child Support.svg"
    );
    expect(
      categoryIconAssets["life-books-audio-subscriptions"]?.defaultKey
    ).toBe("life-entertainment.books-audio-subscriptions");
  });
  it("scopes gradients per instance and preserves supplied colors", () => {
    for (const { key, prefix, color } of [
      { key: "food-drinks", prefix: "first", color: "#FF6C55" },
      { key: "shopping", prefix: "second", color: "#F58B25" },
      { key: "food-drinks", prefix: "third", color: "#FF6C55" }
    ]) {
      const original = categoryIconAssets[key]!.xml;
      const scoped = categoryIconXml(key, `:${prefix}:`);
      const ids = [...original.matchAll(/\bid="([^"]+)"/g)].map(
        (match) => match[1]!
      );
      const references = [...original.matchAll(/url\(#([^)]+)\)/g)].map(
        (match) => match[1]!
      );
      expect(ids.length).toBeGreaterThan(0);
      expect(references.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(scoped).toContain(`id="${prefix}-${id}"`);
        expect(scoped).not.toContain(`id="${id}"`);
      }
      for (const reference of references) {
        expect(scoped).toContain(`url(#${prefix}-${reference})`);
        expect(scoped).not.toContain(`url(#${reference})`);
      }
      expect(scoped).toContain(color);
    }
  });
  it("uses the neutral fallback for personal, missing and unknown keys", () => {
    for (const key of [
      undefined,
      "category",
      "future-unknown",
      "../../outside.svg",
      "toString"
    ])
      expect(categoryIconXml(key, "instance")).toBeNull();
  });
});
